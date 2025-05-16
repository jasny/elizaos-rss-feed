import {
    AgentRuntime,
    elizaLogger,
    IAgentRuntime,
    Service,
    ServiceType,
    stringToUuid,
    UUID,
} from '@elizaos/core';
import * as knowledge from './utils/knowledge';
import Parser, { Item, Output } from 'rss-parser';
import pLimit from 'p-limit';
import Turndown from 'turndown';
import { isValidUuid } from './utils/zod.ts';

interface FeedSettings {
    url: string;
    name: string;
    interval?: number;
    exclude?: string[];
    useCategories?: boolean;
}

type Fetch = typeof fetch;

interface CustomItem extends Item {
    'content:encoded': string;
    'contentSnippet:encoded': string;
    description: string;
}

type Feed = Output<CustomItem> & { lastBuildDate?: string };

const EXPIRATION = 1000 * 60 * 60 * 24 * 3; // 3 days

export class RssFeedService extends Service {
    static serviceType = 'rss-feed' as ServiceType;

    private initialized = false;
    private fetch: Fetch;
    private parser: Parser<{ lastBuildDate: string }, CustomItem>;
    private turndown: Turndown;

    async initialize(runtime: IAgentRuntime): Promise<void> {
        if (this.initialized) return; // Why is `initialize` called twice?
        this.initialized = true;

        this.turndown = new Turndown();
        this.turndown.addRule('no-images', {
            filter: 'img',
            replacement: () => '',
        });
        this.turndown.addRule('no-links', {
            filter: 'a',
            replacement: (content) => content,
        });

        this.fetch = runtime.fetch ?? fetch;
        this.parser = new Parser({
            customFields: {
                item: ['content:encoded', 'contentSnippet:encoded', 'description'],
            },
        });

        const feeds = runtime.getSetting('rss_feeds') as unknown as FeedSettings[] | null;

        if (!feeds || feeds.length === 0) {
            elizaLogger.log('No RSS feeds configured');
            return;
        }

        for (const feed of feeds) {
            await this.createAccount(runtime, feed);
            await this.ingestFeed(runtime, feed);
            setInterval(() => this.ingestFeed(runtime, feed), feed.interval ?? 1000 * 60 * 15);
        }

        const feedIds = feeds.map((settings) => stringToUuid(settings.url));
        setInterval(() => this.removeOldArticles(runtime, feedIds), 1000 * 60 * 60);
    }

    private async createAccount(runtime: IAgentRuntime, settings: FeedSettings): Promise<void> {
        const id = stringToUuid(settings.url);

        if (await runtime.databaseAdapter.getAccountById(id)) {
            return;
        }

        await runtime.databaseAdapter.createAccount({
            id,
            name: settings.name,
            username: '',
            email: '',
            details: {
                type: 'rss-feed',
                url: settings.url,
            },
        });
    }

    private async ingestFeed(runtime: IAgentRuntime, settings: FeedSettings): Promise<void> {
        elizaLogger.info(`Ingesting RSS feed ${settings.name} from ${settings.url}`);

        const response = await this.fetch(settings.url);

        if (!response.ok) {
            elizaLogger.warn(`Failed to fetch RSS feed ${settings.name} from ${settings.url}`);
            return;
        }

        const text = await response.text();
        const feed = await this.parser.parseString(text);

        const limit = pLimit(10);

        const promises = feed.items.map((item) =>
            limit(() => this.addArticle(runtime, item, settings))
        );
        const added = (await Promise.all(promises)).reduce((a, b) => a + b, 0);

        elizaLogger.success(`Added ${added} memories from RSS feed ${settings.name}`);

        if (added > 0) {
            await this.addHeadlines(runtime, feed, settings);
        }
    }

    private async addHeadlines(
        runtime: IAgentRuntime,
        feed: Feed,
        settings: FeedSettings
    ): Promise<void> {
        const id = stringToUuid(settings.url);
        const title = `Latest News from ${settings.name}`;
        const topics = [
            'The latest headlines.',
            'What is the latest news?',
            "What's happening in the crypto space?",
            'Is there any news that you should be aware of?',
            "What's going on?",
        ];

        const list = feed.items.map(
            (item) =>
                `**${item.title.trim()}**: ${this.turndown
                    .turndown(item.summary ?? item.description)
                    .replace('\n', ' ')
                    .trim()}`
        );
        const text = [title, ...list.map((i) => `    - ${i}`), ''].join('\n');

        const fragment = [title, ...topics].map((text) => knowledge.preprocess(text)).join(' ');

        await knowledge.remove(runtime, stringToUuid(settings.url));

        await knowledge.set(runtime as AgentRuntime, {
            id,
            userId: id,
            content: {
                text,
                source: settings.url,
            },
            fragments: [fragment],
            createdAt: feed.lastBuildDate ? new Date(feed.lastBuildDate).getTime() : Date.now(),
        });

        elizaLogger.success(`Added headlines from RSS feed ${settings.name}`);
    }

    private async addArticle(
        runtime: IAgentRuntime,
        item: CustomItem,
        settings: FeedSettings
    ): Promise<number> {
        if (
            (settings.exclude ?? []).some((text) =>
                item.title.toLowerCase().includes(text.toLowerCase())
            )
        ) {
            elizaLogger.debug(`Excluding article ${item.title} from ${settings.name}`);
            return 0;
        }

        const id = isValidUuid(item.guid) ? item.guid : stringToUuid(item.guid ?? item.link);
        const feedId = stringToUuid(settings.url);

        if (await runtime.documentsManager.getMemoryById(id)) {
            return 0;
        }

        const content = this.turndown.turndown(
            item['content:encoded'] ??
                item.content ??
                item['contentSnippet:encoded'] ??
                item.contentSnippet ??
                item.summary ??
                item.description
        );
        const text = `**${item.title}**: ${content.replace(/\n+/g, ' ').trim()}`;
        const fragments = content
            .split(/\n{2,}/)
            .map((text) => text.replace(/\n/g, ' ').trim())
            .filter((text) => text.length > 0)
            .map((text) => knowledge.preprocess(`${item.title} ${text}`));

        const categories = (settings.useCategories && item.categories
            ? item.categories
            : []) as unknown as Array<{ $: Record<string, string>; _: string }>;
        const extraFragments = categories
            .filter(
                (category: { $: Record<string, string>; _: string }) => category.$?.domain === 'tag'
            )
            .map((category: { $: Record<string, string>; _: string }) => category._)
            .map((category) =>
                knowledge.preprocess(
                    `Why is ${category} up or down? What's going on with ${category}? What's the latest news on ${category}?`
                )
            );

        await knowledge.set(runtime as AgentRuntime, {
            id,
            userId: feedId,
            content: {
                text,
                url: item.link,
                source: settings.url,
            },
            createdAt: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
            fragments: [...fragments, ...extraFragments],
        });

        return 1;
    }

    private async removeOldArticles(runtime: IAgentRuntime, feedIds: UUID[]): Promise<void> {
        for (const feedId of feedIds) {
            await knowledge.clear(runtime, feedId, new Date(Date.now() - EXPIRATION));
        }
    }
}
