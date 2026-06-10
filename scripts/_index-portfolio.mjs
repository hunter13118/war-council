import { indexRepo } from '../memory-engine/indexer.js';
import { resolve } from 'path';

const root = 'D:/personal webapp portfolio';
const store = resolve(root, '.cline-context', 'vector-store.json');
console.log('Indexing portfolio...');
const r = await indexRepo({ rootDir: root, storePath: store });
console.log(`Done: ${r.filesProcessed} files, ${r.chunksCreated} chunks, ${r.errors.length} errors`);
