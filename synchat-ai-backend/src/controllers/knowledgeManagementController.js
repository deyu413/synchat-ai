const supabase = require('../services/supabaseClient');
const multer = require('multer');
const path = require('path');
const ingestionService = require('../services/ingestionService'); // Import the service

// Configure Multer for file uploads
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['application/pdf', 'text/plain'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and TXT files are allowed.'), false);
  }
};

const uploadStrategy = multer({ storage, fileFilter });

// --- Controller Functions ---

// 1. Upload File
const uploadFile = [
  uploadStrategy.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded or file type is invalid. Only PDF and TXT files are allowed.' });
    }

    const client_id = req.user.id;
    const original_filename = req.file.originalname;
    const storagePath = `knowledge_files/${client_id}/${original_filename}`;
    const fileMimeType = req.file.mimetype;

    try {
      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('knowledge_files') // Assuming this bucket exists
        .upload(storagePath, req.file.buffer, {
          contentType: fileMimeType,
          upsert: true, // Overwrite if file already exists
        });

      if (uploadError) {
        console.error('Supabase storage upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload file to storage.', error: uploadError.message });
      }

      // Determine source_type
      let sourceType;
      if (fileMimeType === 'application/pdf') {
        sourceType = 'pdf';
      } else if (fileMimeType === 'text/plain') {
        sourceType = 'txt';
      } else {
        // This case should ideally be prevented by multer's fileFilter
        return res.status(400).json({ message: 'Unsupported file type.' });
      }

      // Insert into public.knowledge_sources
      const { data: newSource, error: insertError } = await supabase
        .from('knowledge_sources')
        .insert({
          client_id: client_id,
          source_name: original_filename,
          storage_path: storagePath,
          source_type: sourceType,
          status: 'uploaded', // Or 'pending_ingest'
          // character_count, last_ingest_at, last_ingest_error, content_text are default/null
        })
        .select()
        .single(); // .single() to get the inserted row as an object

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        // Attempt to remove the uploaded file if DB insert fails
        await supabase.storage.from('knowledge_files').remove([storagePath]);
        return res.status(500).json({ message: 'Failed to record knowledge source in database.', error: insertError.message });
      }

      res.status(201).json(newSource);
    } catch (error) {
      console.error('Error in uploadFile controller:', error);
      res.status(500).json({ message: 'An unexpected error occurred during file upload.', error: error.message });
    }
  },
];

// 2. Get All Sources for a Client
const getSources = async (req, res) => {
  const client_id = req.user.id;

  try {
    let allSources = [];

    // Fetch URL source from synchat_clients
    const { data: clientData, error: clientError } = await supabase
      .from('synchat_clients')
      .select('knowledge_source_url, knowledge_source_url_last_ingest_at')
      .eq('client_id', client_id)
      .single();

    if (clientError) {
      console.warn('Error fetching client URL, proceeding without it:', clientError.message);
      // Not returning, as we still want to fetch other sources if possible
    }

    if (clientData && clientData.knowledge_source_url) {
      allSources.push({
        source_id: 'main_url', // Special identifier for the client's main URL
        client_id: client_id,
        source_type: 'url',
        source_name: clientData.knowledge_source_url,
        storage_path: null,
        content_text: null, // Assuming URL content is not stored directly here
        status: clientData.knowledge_source_url_last_ingest_at ? 'completed' : 'pending_ingest', // Simplified status
        character_count: null,
        last_ingest_at: clientData.knowledge_source_url_last_ingest_at,
        last_ingest_error: null, // Assuming no error or error is not stored here
        created_at: null, // Main URL doesn't have a 'created_at' in knowledge_sources
        updated_at: null, // Main URL doesn't have an 'updated_at' in knowledge_sources
      });
    }

    // Fetch file/article sources from knowledge_sources
    const { data: fileSources, error: sourcesError } = await supabase
      .from('knowledge_sources')
      .select('*')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false });

    if (sourcesError) {
      console.error('Error fetching knowledge sources:', sourcesError);
      return res.status(500).json({ message: 'Failed to retrieve knowledge sources.', error: sourcesError.message });
    }

    if (fileSources) {
      allSources = allSources.concat(fileSources);
    }

    res.status(200).json(allSources);
  } catch (error) {
    console.error('Error in getSources controller:', error);
    res.status(500).json({ message: 'An unexpected error occurred while retrieving sources.', error: error.message });
  }
};

// 3. Ingest Source
const ingestSource = async (req, res) => {
  const { source_id } = req.params;
  const client_id = req.user.id;

  if (!source_id) {
    return res.status(400).json({ message: 'Source ID is required.' });
  }

  console.log(`(Controller) Received request to ingest source_id: ${source_id} for client_id: ${client_id}`);

  try {
    // Special handling for 'main_url' if it's passed as source_id
    // The ingestionService.ingestWebsite (which calls ingestSourceById) handles creating/finding the actual source_id for a URL.
    // If the frontend sends 'main_url' directly to this endpoint, we might need to resolve it first or
    // ensure ingestSourceById can handle 'main_url' as a special case (which the current ingestionService does not directly).
    // For now, we assume source_id is a valid UUID from knowledge_sources, or ingestWebsite has been called for URLs.
    // The current frontend logic for 'main_url' in dashboard.js tries to use knowledgeUrlInput.value.
    // This endpoint is for specific source_id ingestion.

    if (source_id === 'main_url') {
        // This case needs careful handling. The `ingestWebsite` function in `ingestionService`
        // is responsible for taking a URL, finding/creating a `knowledge_sources` record, and then calling `ingestSourceById`.
        // If the frontend directly calls this endpoint with 'main_url', it implies we need to fetch the configured URL
        // for the client and then trigger its ingestion.

        const { data: clientConfig, error: configError } = await supabase
            .from('synchat_clients')
            .select('knowledge_source_url')
            .eq('client_id', client_id)
            .single();

        if (configError || !clientConfig || !clientConfig.knowledge_source_url) {
            return res.status(404).json({ message: 'Main URL not configured for this client or error fetching configuration.' });
        }
        
        const mainUrlToIngest = clientConfig.knowledge_source_url;
        console.log(`(Controller) Ingesting main_url, which is: ${mainUrlToIngest} for client_id: ${client_id}`);
        
        // Call ingestWebsite, which handles the logic of finding/creating the source row
        // and then calling ingestSourceById with the actual UUID.
        const result = await ingestionService.ingestWebsite(client_id, mainUrlToIngest);

        if (result.success) {
            return res.status(200).json({ message: 'Main URL ingestion process started/completed successfully.', details: result });
        } else {
            // ingestWebsite itself returns appropriate error messages.
            // Status code might depend on the nature of the error (e.g., 400 for bad URL, 500 for internal)
            // For simplicity, using 500 for any failure from the service here.
            return res.status(500).json({ message: 'Main URL ingestion failed.', error: result.error, details: result });
        }
    } else {
        // Standard ingestion for a specific source_id (UUID)
        const result = await ingestionService.ingestSourceById(source_id, client_id);

        if (result.success) {
            return res.status(200).json({ message: 'Ingestion process started/completed successfully.', details: result });
        } else {
            // Determine appropriate status code based on error type
            // If result.error indicates "Source ... not found", a 404 might be suitable.
            // Otherwise, 500 for general ingestion failures.
            let statusCode = 500;
            if (result.error && result.error.toLowerCase().includes('not found')) {
                statusCode = 404;
            }
            return res.status(statusCode).json({ message: 'Ingestion failed.', error: result.error, details: result });
        }
    }
  } catch (error) {
    console.error(`(Controller) Unexpected error during ingestion for source_id ${source_id}:`, error);
    res.status(500).json({ message: 'An unexpected error occurred on the server during ingestion.', error: error.message });
  }
};

// 4. Delete Source
const deleteSource = async (req, res) => {
  const { source_id } = req.params;
  const client_id = req.user.id;

  if (!source_id) {
    return res.status(400).json({ message: 'Source ID is required.' });
  }

  if (source_id === 'main_url') {
    return res.status(400).json({ message: 'La URL principal configurada no se puede eliminar a través de esta vía. Modifíquela en la configuración general.' });
  }

  console.log(`(Controller) Received request to delete source_id: ${source_id} for client_id: ${client_id}`);

  try {
    // 1. Fetch Source Details
    const { data: source, error: fetchError } = await supabase
      .from('knowledge_sources')
      .select('source_id, client_id, source_type, storage_path')
      .eq('source_id', source_id)
      .eq('client_id', client_id)
      .single();

    if (fetchError) {
      console.error(`(Controller) Error fetching source ${source_id} for client ${client_id}:`, fetchError.message);
      // Check if the error is "PGRST116" which means "JSON object requested, multiple (or no) rows returned"
      // This typically indicates the source was not found for the given client_id and source_id.
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ message: `Fuente de conocimiento con ID ${source_id} no encontrada para este cliente.` });
      }
      return res.status(500).json({ message: 'Error al buscar la fuente de conocimiento.', error: fetchError.message });
    }

    if (!source) { // Should be caught by PGRST116, but as a fallback
      return res.status(404).json({ message: `Fuente de conocimiento con ID ${source_id} no encontrada.` });
    }

    // 2. Delete from Supabase Storage (if applicable)
    if ((source.source_type === 'pdf' || source.source_type === 'txt') && source.storage_path) {
      console.log(`(Controller) Deleting file from storage: ${source.storage_path}`);
      const { error: storageError } = await supabase.storage
        .from('knowledge_files') // Ensure this is your correct bucket name
        .remove([source.storage_path]);

      if (storageError) {
        // Log error but proceed. The file might not exist, or permissions issue.
        // Critical part is DB cleanup.
        console.warn(`(Controller) Error deleting file ${source.storage_path} from storage: ${storageError.message}. Proceeding with DB cleanup.`);
      } else {
        console.log(`(Controller) File ${source.storage_path} deleted from storage successfully.`);
      }
    }

    // 3. Delete Chunks from public.knowledge_base (Critical)
    console.log(`(Controller) Deleting chunks from knowledge_base for source_id: ${source_id}`);
    const { error: kbDeleteError } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('client_id', client_id)
      .eq('metadata->>original_source_id', source_id); // Ensure metadata field is correct

    if (kbDeleteError) {
      console.error(`(Controller) Critical error deleting chunks from knowledge_base for source ${source_id}:`, kbDeleteError.message);
      // This is a more critical error. If chunks are left orphaned, it's problematic.
      return res.status(500).json({ message: 'Error eliminando los datos de conocimiento asociados.', error: kbDeleteError.message });
    }
    console.log(`(Controller) Chunks for source ${source_id} deleted from knowledge_base.`);

    // 4. Delete from public.knowledge_sources
    console.log(`(Controller) Deleting source entry from knowledge_sources for source_id: ${source_id}`);
    const { error: sourceDeleteError } = await supabase
      .from('knowledge_sources')
      .delete()
      .eq('client_id', client_id)
      .eq('source_id', source_id);

    if (sourceDeleteError) {
      console.error(`(Controller) Error deleting source ${source_id} from knowledge_sources:`, sourceDeleteError.message);
      return res.status(500).json({ message: 'Error eliminando la entrada de la fuente de conocimiento.', error: sourceDeleteError.message });
    }
    console.log(`(Controller) Source ${source_id} deleted from knowledge_sources successfully.`);

    // 5. Response Handling
    res.status(200).json({ message: 'Fuente de conocimiento eliminada exitosamente.' });

  } catch (error) {
    console.error(`(Controller) Unexpected error during deletion of source_id ${source_id}:`, error);
    res.status(500).json({ message: 'Un error inesperado ocurrió en el servidor durante la eliminación.', error: error.message });
  }
};

module.exports = {
  uploadFile,
  getSources,
  ingestSource,
  deleteSource,
};
