/**
 * Storage utilities for R2 with gzip compression
 */

/**
 * Store JSON data with gzip compression
 */
export async function putGzJson(
  r2: R2Bucket,
  key: string,
  data: any
): Promise<void> {
  const jsonStr = JSON.stringify(data);
  
  // Use CompressionStream API (available in Workers)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(jsonStr));
      controller.close();
    }
  });
  
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const compressedData = await new Response(compressedStream).arrayBuffer();
  
  await r2.put(key, compressedData, {
    httpMetadata: {
      contentType: 'application/json',
      contentEncoding: 'gzip'
    }
  });
}

/**
 * Retrieve and decompress JSON data
 */
export async function getGzJson(
  r2: R2Bucket,
  key: string
): Promise<any | null> {
  const object = await r2.get(key);
  
  if (!object) {
    return null;
  }
  
  const arrayBuffer = await object.arrayBuffer();
  
  // Check if it's gzipped
  const isGzipped = object.httpMetadata?.contentEncoding === 'gzip';
  
  if (isGzipped) {
    // Decompress using DecompressionStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(arrayBuffer));
        controller.close();
      }
    });
    
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const decompressedData = await new Response(decompressedStream).text();
    
    return JSON.parse(decompressedData);
  } else {
    // Not compressed, parse directly
    const text = new TextDecoder().decode(arrayBuffer);
    return JSON.parse(text);
  }
}

/**
 * List objects with a prefix
 */
export async function listObjects(
  r2: R2Bucket,
  prefix: string,
  limit: number = 1000
): Promise<R2Objects> {
  return await r2.list({
    prefix,
    limit
  });
}

/**
 * Delete objects with a prefix
 */
export async function deleteObjects(
  r2: R2Bucket,
  keys: string[]
): Promise<void> {
  // R2 supports batch delete up to 1000 keys
  const batchSize = 1000;
  
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    await Promise.all(batch.map(key => r2.delete(key)));
  }
}

/**
 * Copy an object within R2
 */
export async function copyObject(
  r2: R2Bucket,
  sourceKey: string,
  destKey: string
): Promise<void> {
  const object = await r2.get(sourceKey);
  
  if (!object) {
    throw new Error(`Source object ${sourceKey} not found`);
  }
  
  const data = await object.arrayBuffer();
  
  await r2.put(destKey, data, {
    httpMetadata: object.httpMetadata
  });
}