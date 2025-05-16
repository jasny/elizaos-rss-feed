# @elizaos/plugin-rss-feed

An ElizaOS plugin that fetches RSS/Atom feeds and adds recent articles to the agent's memory. This allows the agent to stay up-to-date with current events, blogs, or other domain-specific news.

## Features

* Periodically fetches and parses configured RSS feeds
* Converts feed items into agent memories with embeddings
* Adds summary headlines for agent recall
* Skips duplicates and old articles
* Automatically cleans up outdated content

## Installation

```bash
npm install @elizaos/rss-feed
```

## Configuration

Define the RSS feeds in your Eliza character or runtime settings:

```json
{
  "settings": {
    "rss_feeds": [
      {
        "url": "https://example.com/rss",
        "name": "Example News",
        "category": "news",
        "interval": 900,
        "exclude": ["sponsored", "advertisement"]
      }
    ]
  },
  "plugins": ["rss-feed"]
}
```

### Feed Options

| Field      | Description                                         |
| ---------- | --------------------------------------------------- |
| `url`      | RSS or Atom feed URL                                |
| `name`     | Name used for memory fragments                      |
| `category` | (Optional) Used for grouping                        |
| `interval` | (Optional) Fetch interval in seconds (default: 900) |
| `exclude`  | (Optional) List of keywords to skip articles        |

## Behavior

* Articles are fetched on startup and at regular intervals
* Content is converted from HTML to Markdown using Turndown
* New articles are stored with memory fragments and can be recalled by the agent
* A short summary of headlines is added for quick reference
* Articles older than 3 days are automatically removed
