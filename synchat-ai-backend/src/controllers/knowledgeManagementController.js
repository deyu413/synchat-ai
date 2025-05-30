import { supabase } from '../services/supabaseClient.js';
import multer from 'multer';
import path from 'path';
import * as ingestionService from '../services/ingestionService.js';
import * as db from '../services/databaseService.js'; // Import databaseService

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
export const uploadFile = [
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
export const getSources = async (req, res) => {
  const client_id = req.user.id;

  try {
    let allSources = [];

    // Fetch URL source from synchat_clients
    const { data: clientData, error: clientError } = await supabase
      .from('synchat_clients')
      .select('knowledge_source_url, last_ingest_status, last_ingest_at') // CORRECTED: Selected correct columns
      .eq('client_id', client_id)
      .single();

    if (clientError && clientError.code !== 'PGRST116') { // PGRST116 means no rows found, which is not a fatal error here
      console.error('Error fetching client URL details:', clientError.message);
      // Not returning immediately, try to fetch other sources. 
      // If this is the only source and it fails, the response might be empty or an error later.
      // Consider if a 500 is appropriate if this specific query fails for other reasons.
    }

    if (clientData && clientData.knowledge_source_url) {
      allSources.push({
        source_id: 'main_url', // Special identifier for the client's main URL
        client_id: client_id,
        source_type: 'url',
        source_name: clientData.knowledge_source_url,
        storage_path: null,
        content_text: null,
        status: clientData.last_ingest_status || (clientData.knowledge_source_url ? 'pending_ingest' : 'N/A'), // CORRECTED: Use last_ingest_status
        character_count: null, // This info is not on synchat_clients for the main URL
        last_ingest_at: clientData.last_ingest_at, // CORRECTED: Use last_ingest_at
        last_ingest_error: null, // This info is not on synchat_clients for the main URL
        created_at: null, 
        updated_at: null,
      });
    }

    // Fetch file/article sources from knowledge_sources
    const { data: fileSources, error: sourcesError } = await supabase
      .from('knowledge_sources')
      .select('*')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false });

    if (sourcesError) {
      console.error('Error fetching knowledge sources from knowledge_sources table:', sourcesError);
      // If clientData also failed or was not present, and this fails, then return 500.
      // If clientData was found, we might still want to return that partial data, or a specific error.
      // For simplicity now, if this critical part fails, we return 500.
      return res.status(500).json({ message: 'Failed to retrieve file/article knowledge sources.', error: sourcesError.message });
    }

    if (fileSources) {
      allSources = allSources.concat(fileSources);
    }
    
    // If allSources is still empty after trying both, it's not an error, just no sources.
    res.status(200).json(allSources);

  } catch (error) {
    // This catch block handles unexpected errors in the overall logic of getSources
    console.error('Unexpected error in getSources controller:', error);
    res.status(500).json({ message: 'An unexpected error occurred while retrieving sources.', error: error.message });
  }
};

// 3. Ingest Source
export const ingestSource = async (req, res) => {
  const { source_id } = req.params;
  const client_id = req.user.id;

  if (!source_id) {
    return res.status(400).json({ message: 'Source ID is required.' });
  }

  console.log(`(Controller) Received request to ingest source_id: ${source_id} for client_id: ${client_id}`);

  try {
    if (source_id === 'main_url') {
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
        
        const result = await ingestionService.ingestWebsite(client_id, mainUrlToIngest);

        if (result.success) {
            return res.status(200).json({ message: 'Main URL ingestion process started/completed successfully.', details: result });
        } else {
            return res.status(500).json({ message: 'Main URL ingestion failed.', error: result.error, details: result });
        }
    } else {
        const result = await ingestionService.ingestSourceById(source_id, client_id);

        if (result.success) {
            return res.status(200).json({ message: 'Ingestion process started/completed successfully.', details: result });
        } else {
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

// 4. Get Chunk Sample for a Source
export const getSourceChunkSample = async (req, res) => {
  const { source_id } = req.params;
  const client_id = req.user.id; // Assuming authMiddleware populates req.user with client_id

  if (!source_id) {
    return res.status(400).json({ message: 'Source ID is required.' });
  }

  console.log(`(Controller) Received request for chunk sample for source_id: ${source_id} for client_id: ${client_id}`);

  try {
    // Using a default limit of 5 for the sample
    const chunks = await db.getChunkSampleForSource(client_id, source_id, 5);

    if (!chunks) { // Should not happen if getChunkSampleForSource throws or returns []
        return res.status(404).json({ message: 'No chunk samples found or error fetching samples.' });
    }

    res.status(200).json(chunks);

  } catch (error) {
    console.error(`(Controller) Error fetching chunk sample for source_id ${source_id}:`, error);
    if (error.message.toLowerCase().includes("not found")) { // More generic check
        return res.status(404).json({ message: `Samples for source ID ${source_id} not found.` });
    }
    res.status(500).json({ message: 'An unexpected error occurred on the server while fetching chunk samples.', error: error.message });
  }
};


// 5. Delete Source
export const deleteSource = async (req, res) => {
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
    const { data: source, error: fetchError } = await supabase
      .from('knowledge_sources')
      .select('source_id, client_id, source_type, storage_path')
      .eq('source_id', source_id)
      .eq('client_id', client_id)
      .single();

    if (fetchError) {
      console.error(`(Controller) Error fetching source ${source_id} for client ${client_id}:`, fetchError.message);
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ message: `Fuente de conocimiento con ID ${source_id} no encontrada para este cliente.` });
      }
      return res.status(500).json({ message: 'Error al buscar la fuente de conocimiento.', error: fetchError.message });
    }

    if (!source) { 
      return res.status(404).json({ message: `Fuente de conocimiento con ID ${source_id} no encontrada.` });
    }

    if ((source.source_type === 'pdf' || source.source_type === 'txt') && source.storage_path) {
      console.log(`(Controller) Deleting file from storage: ${source.storage_path}`);
      const { error: storageError } = await supabase.storage
        .from('knowledge_files')
        .remove([source.storage_path]);

      if (storageError) {
        console.warn(`(Controller) Error deleting file ${source.storage_path} from storage: ${storageError.message}. Proceeding with DB cleanup.`);
      } else {
        console.log(`(Controller) File ${source.storage_path} deleted from storage successfully.`);
      }
    }

    console.log(`(Controller) Deleting chunks from knowledge_base for source_id: ${source_id}`);
    const { error: kbDeleteError } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('client_id', client_id)
      .eq('metadata->>original_source_id', source_id); 

    if (kbDeleteError) {
      console.error(`(Controller) Critical error deleting chunks from knowledge_base for source ${source_id}:`, kbDeleteError.message);
      return res.status(500).json({ message: 'Error eliminando los datos de conocimiento asociados.', error: kbDeleteError.message });
    }
    console.log(`(Controller) Chunks for source ${source_id} deleted from knowledge_base.`);

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

    res.status(200).json({ message: 'Fuente de conocimiento eliminada exitosamente.' });

  } catch (error) {
    console.error(`(Controller) Unexpected error during deletion of source_id ${source_id}:`, error);
    res.status(500).json({ message: 'Un error inesperado ocurrió en el servidor durante la eliminación.', error: error.message });
  }
};
