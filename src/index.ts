import { Plugin } from '@elizaos/core';
import { RssFeedService } from './service.ts';

const rssFeedService = new RssFeedService();

export const rssFeedPlugin: Plugin = {
    name: 'rss-feed',
    description: 'Ingests RSS feeds and add it as knowledge',
    services: [rssFeedService],
};
