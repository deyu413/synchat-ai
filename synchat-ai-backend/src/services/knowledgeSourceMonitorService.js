// src/services/knowledgeSourceMonitorService.js
import axios from 'axios';
import crypto from 'crypto';
import { load } from 'cheerio'; // For HTML parsing
import { supabase } from './supabaseClient.js'; // Assuming supabaseClient.js exports the initialized client

const USER_AGENT = 'Mozilla/5.0 (compatible; SynChatMonitor/1.0; +https://www.synchatai.com/bot-monitor)'; // Specific user agent for this service

/**
 * Simplified text extraction from HTML content.
 * A more robust version might exist in ingestionService.js; this is tailored for monitoring.
 * @param {string} htmlContent - The HTML string.
 * @returns {string} - The extracted plain text.
 */
function extractTextFromHTML(htmlContent) {
    if (!htmlContent) return "";
    try {
        const $ = load(htmlContent);
        // Remove script, style, nav, footer, header, aside, form, etc.
        $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();

        // Get text from common content tags, trying to respect some block structure with newlines.
        let text = '';
        $('h1, h2, h3, h4, h5, h6, p, li, pre, article, .main-content, .content, .post-body, .entry-content').each((i, elem) => {
            const blockText = $(elem).text();
            if (blockText) {
                text += blockText.replace(/\s\s+/g, ' ').trim() + '\n\n'; // Add double newline for separation
            }
        });

        if (!text) { // Fallback if no specific tags found or they are empty
            text = $('body').text();
        }

        return text.replace(/\s\s+/g, ' ').trim(); // Final cleanup
    } catch (error) {
        console.error("(MonitorService) Error extracting text from HTML with Cheerio:", error.message);
        // Fallback to very basic stripping if Cheerio fails unexpectedly
        return htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s\s+/g, ' ').trim();
    }
}

/**
 * Checks the status of a URL-based knowledge source, detects content changes via hashing.
 * @param {string} source_id - The UUID of the knowledge source.
 * @param {string} source_url - The URL to check.
 * @param {string|null} current_content_hash_from_db - The last known content hash from the DB.
 */
export async function checkUrlSourceStatus(source_id, source_url, current_content_hash_from_db) {
    console.log(`(MonitorService) Checking source_id: ${source_id}, URL: ${source_url}`);
    let accessibilityStatus = 'UNKNOWN_ERROR';
    let newHash = null;
    let statusForKnowledgeSource = null; // This is the main 'status' column of knowledge_sources

    try {
        const response = await axios.get(source_url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000 // 15 seconds timeout
        });

        if (response.status >= 200 && response.status < 300) {
            const htmlContent = response.data;
            if (!htmlContent) {
                accessibilityStatus = 'ERROR_EMPTY_CONTENT';
            } else {
                const newTextContent = extractTextFromHTML(htmlContent);
                if (!newTextContent.trim()) {
                     accessibilityStatus = 'ERROR_NO_TEXT_EXTRACTED';
                } else {
                    newHash = crypto.createHash('sha256').update(newTextContent).digest('hex');
                    if (current_content_hash_from_db && current_content_hash_from_db === newHash) {
                        accessibilityStatus = 'OK';
                    } else {
                        accessibilityStatus = 'CONTENT_CHANGED_SIGNIFICANTLY';
                        statusForKnowledgeSource = 'pending_reingest'; // Mark for re-ingestion
                        console.log(`(MonitorService) Content change detected for source_id: ${source_id}. Old hash: ${current_content_hash_from_db}, New hash: ${newHash}`);
                    }
                }
            }
        } else {
            // This case should ideally be caught by axios's error handling for non-2xx,
            // but included for robustness if axios config changes.
            accessibilityStatus = `ERROR_${response.status}`;
            console.warn(`(MonitorService) Received non-2xx HTTP status ${response.status} for source_id: ${source_id}`);
        }
    } catch (error) {
        if (error.response) { // HTTP error (4xx, 5xx)
            accessibilityStatus = `ERROR_${error.response.status}`;
            console.warn(`(MonitorService) HTTP error for source_id: ${source_id}. Status: ${error.response.status}, URL: ${source_url}`);
        } else if (error.request) { // Network error, DNS, timeout, etc.
            accessibilityStatus = 'ERROR_CONNECTION';
            console.warn(`(MonitorService) Network/Connection error for source_id: ${source_id}. URL: ${source_url}`, error.message);
        } else { // Other errors
            accessibilityStatus = 'ERROR_UNSPECIFIED_FETCH';
            console.error(`(MonitorService) Unspecified error checking source_id: ${source_id}. URL: ${source_url}`, error.message);
        }
    }

    // Update knowledge_sources table
    const updatePayload = {
        last_accessibility_check_at: new Date().toISOString(),
        last_accessibility_status: accessibilityStatus,
    };

    if (accessibilityStatus === 'CONTENT_CHANGED_SIGNIFICANTLY' || (accessibilityStatus === 'OK' && newHash)) {
        // Update hash if content changed or if it's first successful check with a new hash
        if (newHash) updatePayload.last_known_content_hash = newHash;
    }

    if (statusForKnowledgeSource) { // e.g., 'pending_reingest'
        updatePayload.status = statusForKnowledgeSource;
    }

    try {
        const { error: dbError } = await supabase
            .from('knowledge_sources')
            .update(updatePayload)
            .eq('source_id', source_id);

        if (dbError) {
            console.error(`(MonitorService) DB Error updating source_id ${source_id}:`, dbError.message);
        } else {
            console.log(`(MonitorService) Updated source_id ${source_id} with status: ${accessibilityStatus}, new hash: ${newHash ? newHash.substring(0,10)+'...' : 'N/A'}. Main status: ${statusForKnowledgeSource || '(no change)'}`);
        }
    } catch (dbUpdateError) {
        console.error(`(MonitorService) DB Exception updating source_id ${source_id}:`, dbUpdateError.message);
    }
}

// Example of how this might be called by a scheduler (not part of this service's direct execution)
/*
async function monitorAllUrlSources() {
    const { data: sources, error } = await supabase
        .from('knowledge_sources')
        .select('source_id, source_name, source_type, last_known_content_hash')
        .eq('source_type', 'url') // Or other reingestable types
        // .lt('next_reingest_at', new Date().toISOString()) // For scheduled re-ingestion
        // .is('next_reingest_at', null) // Or sources that have never been scheduled
        // .neq('reingest_frequency', 'manual') // Exclude manual ones from automated checks perhaps

    if (error) {
        console.error("(MonitorService) Error fetching URL sources for monitoring:", error);
        return;
    }

    if (sources) {
        for (const source of sources) {
            if (source.source_name && source.source_name.startsWith('http')) { // source_name is the URL for 'url' type
                await checkUrlSourceStatus(source.source_id, source.source_name, source.last_known_content_hash);
            }
        }
    }
}
*/
// monitorAllUrlSources(); // Example call
