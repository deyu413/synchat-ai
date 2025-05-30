import { supabase } from '../services/supabaseClient.js';
import multer from 'multer';
import path from 'path';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
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

    // Validate original_filename
    if (!original_filename || typeof original_filename !== 'string') {
        return res.status(400).json({ message: 'Invalid filename.' });
    }
    if (original_filename.length > 255) {
        return res.status(400).json({ message: 'Filename exceeds maximum length of 255 characters.' });
    }
    if (/[/\\]|\.\./.test(original_filename)) { // Checks for / or \ or ..
        return res.status(400).json({ message: 'Filename contains invalid characters (/, \\, ..).' });
    }

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
  if (source_id !== 'main_url' && !UUID_REGEX.test(source_id)) {
    return res.status(400).json({ error: 'source_id has an invalid format.' });
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
  if (source_id !== 'main_url' && !UUID_REGEX.test(source_id)) { // 'main_url' is a special case
    return res.status(400).json({ error: 'source_id has an invalid format.' });
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
  // 'main_url' is a special case handled below, other source_ids must be UUIDs.
  if (source_id !== 'main_url' && !UUID_REGEX.test(source_id)) {
    return res.status(400).json({ error: 'source_id has an invalid format.' });
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

// 6. Update Knowledge Source Metadata
export const updateSourceMetadata = async (req, res) => {
  const { source_id } = req.params;
  const clientId = req.user.id; // Assuming authMiddleware populates req.user with client_id as id

  if (!source_id) {
    return res.status(400).json({ message: 'Source ID is required in URL parameters.' });
  }
  if (source_id !== 'main_url' && !UUID_REGEX.test(source_id)) { // 'main_url' is not a UUID
      return res.status(400).json({ error: 'source_id has an invalid format.'});
  }
  if (!clientId) {
    // This should ideally be caught by authMiddleware
    return res.status(401).json({ message: 'Unauthorized: Client ID not found.' });
  }

  // Whitelist fields that can be updated from the request body
  const { reingest_frequency, custom_title, category_tags } = req.body; // Added category_tags
  const metadataUpdates = {};
  const allowedReingestFrequencies = ['daily', 'weekly', 'monthly', 'manual', null];

  if (reingest_frequency !== undefined) {
    if (!allowedReingestFrequencies.includes(reingest_frequency)) {
        return res.status(400).json({ message: `Invalid reingest_frequency. Must be one of: ${allowedReingestFrequencies.join(', ')} or null.` });
    }
    metadataUpdates.reingest_frequency = reingest_frequency;
  }

  if (custom_title !== undefined) {
    if (custom_title === null) { // Allow null to clear it
        metadataUpdates.custom_title = null;
    } else if (typeof custom_title !== 'string') {
        return res.status(400).json({ message: 'custom_title must be a string or null.' });
    } else if (custom_title.length > 255) {
        return res.status(400).json({ message: 'custom_title exceeds maximum length of 255 characters.' });
    } else {
        metadataUpdates.custom_title = custom_title;
    }
  }

  if (category_tags !== undefined) {
    if (category_tags === null || (Array.isArray(category_tags) && category_tags.every(tag => typeof tag === 'string'))) {
        metadataUpdates.category_tags = category_tags;
    } else {
        return res.status(400).json({ message: 'Invalid category_tags format. Must be an array of strings or null.' });
    }
  }
  // Add any other allowed fields here

  if (Object.keys(metadataUpdates).length === 0) {
    return res.status(400).json({ message: 'No valid fields provided for update. Allowed fields: reingest_frequency, custom_title, category_tags.' });
  }

  console.log(`(Controller) Updating metadata for source_id: ${source_id}, client_id: ${clientId}. Updates:`, metadataUpdates);

  try {
    const { data, error, status } = await db.updateKnowledgeSourceMetadata(clientId, source_id, metadataUpdates);

    if (error) {
      // databaseService now returns a status for certain errors
      const statusCode = status || (error.message.includes('not found') ? 404 : 500);
      console.error(`(Controller) Error updating source metadata: ${error.message || error}`);
      return res.status(statusCode).json({ message: error.message || 'Failed to update knowledge source metadata.' });
    }

    res.status(200).json({ message: 'Knowledge source metadata updated successfully.', data });

  } catch (err) {
    // Catch unexpected errors from the service call itself, though most should be handled by returned {error}
    console.error(`(Controller) Unexpected exception updating source metadata for source_id ${source_id}:`, err);
    res.status(500).json({ message: 'An unexpected server error occurred.', error: err.message });
  }
};

// 7. Get Paginated Chunks for a Knowledge Source
export const getKnowledgeSourceChunks = async (req, res) => {
  const { source_id } = req.params;
  const clientId = req.user.id;

  let page = parseInt(req.query.page, 10);
  let pageSize = parseInt(req.query.pageSize, 10);

  if (isNaN(page) || page < 1) {
    page = 1;
  }
  if (isNaN(pageSize) || pageSize < 1 || pageSize > 200) { // Max pageSize to prevent abuse
    pageSize = 50;
  }

  if (!source_id) {
    return res.status(400).json({ message: 'Source ID is required in URL parameters.' });
  }
  if (source_id !== 'main_url' && !UUID_REGEX.test(source_id)) { // 'main_url' is not a UUID
      return res.status(400).json({ error: 'source_id has an invalid format.'});
  }
  if (!clientId) {
    return res.status(401).json({ message: 'Unauthorized: Client ID not found.' });
  }

  console.log(`(Controller) Fetching chunks for source_id: ${source_id}, client_id: ${clientId}, page: ${page}, pageSize: ${pageSize}`);

  try {
    const { data, error, status } = await db.getChunksForSource(clientId, source_id, page, pageSize);

    if (error) {
      const statusCode = status || (error.message.includes('not found') ? 404 : 500);
      console.error(`(Controller) Error fetching chunks for source ${source_id}: ${error.message || error}`);
      return res.status(statusCode).json({ message: error.message || 'Failed to fetch chunks.' });
    }

    // Data is expected to be in the format { chunks, totalCount, page, pageSize }
    res.status(200).json(data);

  } catch (err) {
    console.error(`(Controller) Unexpected exception fetching chunks for source_id ${source_id}:`, err);
    res.status(500).json({ message: 'An unexpected server error occurred while fetching chunks.', error: err.message });
  }
};
