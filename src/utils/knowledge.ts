import {
    getEmbeddingZeroVector,
    IAgentRuntime,
    KnowledgeItem,
    splitChunks,
    knowledge,
    embed,
    stringToUuid,
    UUID,
    elizaLogger,
} from '@elizaos/core';
import { PostgresDatabaseAdapter } from '@elizaos/adapter-postgres';
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite';
import pLimit from 'p-limit';

// Copied from eliza core package.
export async function set(
    runtime: IAgentRuntime,
    item: KnowledgeItem & { userId?: UUID; createdAt?: number; fragments?: string[] },
    chunkSize = 512,
    bleed = 20
) {
    await runtime.documentsManager.createMemory({
        id: item.id,
        agentId: runtime.agentId,
        roomId: runtime.agentId,
        userId: item.userId ?? runtime.agentId,
        createdAt: item.createdAt ?? Date.now(),
        content: item.content,
        embedding: getEmbeddingZeroVector(),
    });

    const fragments =
        item.fragments ??
        (await splitChunks(knowledge.preprocess(item.content.text), chunkSize, bleed));

    for (const fragment of fragments) {
        const embedding = await embed(runtime, fragment);
        await runtime.knowledgeManager.createMemory({
            // We namespace the knowledge base uuid to avoid id
            // collision with the document above.
            id: stringToUuid(item.id + fragment),
            roomId: runtime.agentId,
            agentId: runtime.agentId,
            userId: item.userId ?? runtime.agentId,
            createdAt: Date.now(),
            content: {
                source: item.id,
                text: fragment,
            },
            embedding,
        });
    }
}

export async function clear(
    runtime: IAgentRuntime,
    userId?: UUID,
    createdBefore: Date = new Date()
) {
    if (runtime.databaseAdapter instanceof PostgresDatabaseAdapter) {
        await postgresClear(runtime, userId ?? runtime.agentId, createdBefore);
    } else if (runtime.databaseAdapter instanceof SqliteDatabaseAdapter) {
        await sqliteClear(runtime, userId ?? runtime.agentId, createdBefore);
    } else {
        elizaLogger.warn('Unsupported database adapter for knowledge clear');
    }
}

async function postgresClear(runtime: IAgentRuntime, userId: UUID, createdBefore: Date) {
    const db = runtime.databaseAdapter as PostgresDatabaseAdapter;

    const result = await db.query(
        `DELETE FROM knowledge WHERE "userId" = $1 AND "agentId" = $2 AND "roomId" = $3 AND "type" IN ('knowledge', 'document') AND "createdAt" < $4`,
        [userId, runtime.agentId, runtime.agentId, createdBefore]
    );

    elizaLogger.info(`Cleared ${result.rowCount} knowledge items`);
}

async function sqliteClear(runtime: IAgentRuntime, userId: UUID, createdBefore: Date) {
    const { db } = runtime.databaseAdapter as SqliteDatabaseAdapter;

    const result = db
        .prepare(
            `DELETE FROM knowledge WHERE userId = ? AND agentId = ? AND roomId = ? AND type IN ('knowledge', 'document') AND createdAt < ?`
        )
        .run(userId, runtime.agentId, runtime.agentId, createdBefore.getTime());

    elizaLogger.info(`Cleared ${result.changes} knowledge items`);
}

export async function remove(runtime: IAgentRuntime, id: UUID) {
    await runtime.documentsManager.removeMemory(id);

    if (runtime.databaseAdapter instanceof PostgresDatabaseAdapter) {
        await postgresRemoveFragments(runtime, id);
    } else {
        const limit = pLimit(10);

        const knowledgeItems = await runtime.knowledgeManager.getMemories({
            roomId: runtime.agentId,
        });
        const promises = knowledgeItems
            .filter((item) => item.content.source === id)
            .map((item) => limit(() => runtime.knowledgeManager.removeMemory(item.id)));
        await Promise.all(promises);
    }
}

async function postgresRemoveFragments(runtime: IAgentRuntime, sourceId: UUID) {
    const db = runtime.databaseAdapter as PostgresDatabaseAdapter;

    await db.query(`DELETE FROM memories WHERE type = 'knowledge' AND "content"->>'source' = $1`, [
        sourceId,
    ]);
}

export const preprocess = knowledge.preprocess;
export const get = knowledge.get;
