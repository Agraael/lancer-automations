/**
 * Update a document, through the GM when the current user does not own it.
 * Safe to import from leaf modules: socket.js is only loaded at call time.
 * @param {any} doc
 * @param {object} data
 * @param {object} [options]
 * @returns {Promise<any>} The document
 */
export async function updateRouted(doc, data, options = {})
{
    const { updateDocumentRouted } = await import('../socket.js');
    return updateDocumentRouted(doc, data, options);
}

/**
 * Delete a document, through the GM when the current user lacks the right to.
 * @param {any} doc
 * @param {object} [options]
 * @returns {Promise<void>}
 */
export async function deleteRouted(doc, options = {})
{
    const { deleteDocumentRouted } = await import('../socket.js');
    return deleteDocumentRouted(doc, options);
}
