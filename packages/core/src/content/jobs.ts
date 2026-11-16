/** Queue names and payloads shared by the web app (which sends jobs) and the worker (which runs them). */
export const INDEX_NODE_QUEUE = 'content.index-node';
export const TRANSCRIBE_QUEUE = 'content.transcribe';
export const RECONCILE_QUEUE = 'content.reconcile';

export interface IndexNodeJob {
  nodeId: string;
}

export interface TranscribeJob {
  contentItemId: string;
}
