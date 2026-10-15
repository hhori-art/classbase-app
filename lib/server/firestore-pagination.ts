import 'server-only';

import type {
  DocumentData,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Firestore query results are read page by page so monthly processing is not
 * silently truncated by a fixed `.limit(...)`.
 */
export async function getAllQueryDocuments<T extends DocumentData = DocumentData>(
  query: Query<T>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<QueryDocumentSnapshot<T>[]> {
  const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), DEFAULT_PAGE_SIZE));
  const documents: QueryDocumentSnapshot<T>[] = [];
  let cursor: QueryDocumentSnapshot<T> | null = null;

  while (true) {
    let pageQuery: Query<T> = query.limit(safePageSize);
    if (cursor) pageQuery = query.startAfter(cursor).limit(safePageSize);
    const snapshot = await pageQuery.get();
    if (snapshot.empty) break;

    documents.push(...snapshot.docs);
    const nextCursor = snapshot.docs[snapshot.docs.length - 1];
    if (cursor && nextCursor.id === cursor.id) {
      throw new Error('firestore-pagination-cursor-stalled');
    }
    cursor = nextCursor;

    if (snapshot.size < safePageSize) break;
  }

  return documents;
}
