import { Plugin } from '@opencode/plugin';
import { searchSessions } from '../../lib/session-search.ts';

const DESCRIPTION = `Which past opencode sessions already dealt with this? Answers "who handled it, and what did they conclude?" before you redo the work. One row per session: id, title, directory, last activity, which terms matched, occurrence count and a snippet. Searches session titles and the user/assistant text of every project on this machine; tool output is never searched, so a clue that only ever appeared in a shell result or log dump will not be found.

Pass ONE distinctive term in \`query\` ("magic-context", "feishu-bot", an error string) or 1-6 terms in \`keywords\` with \`require\`. Matching is a literal case-insensitive substring and words are NOT anded, so a sentence matches nothing — send adjectives, questions and dates elsewhere and keep nouns, identifiers and error strings.

Read one of a pair: a hit carrying \`fork_of\` is a copy of that session made with fork, and it diverged since.

Defaults skip archived sessions, subagent children and /tmp scratch work; widen only when a narrow search comes back empty. An empty result carries a \`hint\` saying what to try instead. Prefer fewer, rarer terms over many common ones.`;

// The SDK types `execute` args as `unknown` whenever the input is a plain JSON Schema (only an
// effect Schema or StandardSchema carries its type through), so the shape is declared here. The
// schema below stays the source of truth for the model — this is the TypeScript half of it.
interface SessionSearchInput {
  query?: string;
  keywords?: string[];
  require?: 'any' | 'all';
  match?: 'title' | 'content' | 'both';
  directory?: string;
  days?: number;
  limit?: number;
  include_archived?: boolean;
  include_children?: boolean;
  include_tmp?: boolean;
}

// OpenCode 2 registers tools from plugins; a `tools/<name>.ts` file is not a discovery path
// (verified against 2.1.4). Same shape as the `sysinfo` plugin: the lib holds the logic and also
// runs standalone, so the tool and the CLI can never drift apart.
export default Plugin.define({
  id: 'session-search',
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: 'session_search',
        description: DESCRIPTION,
        input: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'One distinctive term, matched as a literal substring. Not a sentence.',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 6,
              description: 'Several terms instead of one. Use when one term is too common to narrow the search.',
            },
            require: {
              type: 'string',
              enum: ['any', 'all'],
              description: "With keywords: 'any' (default) keeps sessions matching one term, 'all' requires every term. Use 'all' for a precise intersection, 'any' when unsure of the wording.",
            },
            match: {
              type: 'string',
              enum: ['title', 'content', 'both'],
              description: "Where to look. 'both' (default) unions titles and what was written, 'content' searches only the conversation, 'title' only session titles.",
            },
            directory: {
              type: 'string',
              description: 'Restrict to sessions whose working directory contains this substring, e.g. a repo name.',
            },
            days: {
              type: 'integer',
              description: 'Only sessions updated within the last N days.',
            },
            limit: {
              type: 'integer',
              description: 'Rows to return. Default 20, max 100.',
            },
            include_archived: {
              type: 'boolean',
              description: 'Include archived sessions. Default false.',
            },
            include_children: {
              type: 'boolean',
              description: 'Include subagent child sessions. Default false.',
            },
            include_tmp: {
              type: 'boolean',
              description: 'Include sessions that ran under /tmp. Default false — those are scratch work.',
            },
          },
          required: [],
          additionalProperties: false,
        },
        async execute(rawArgs) {
          const args = (rawArgs ?? {}) as SessionSearchInput;
          const result = await searchSessions({
            query: args.query,
            keywords: args.keywords,
            require: args.require,
            match: args.match,
            directory: args.directory,
            days: args.days,
            limit: args.limit,
            includeArchived: args.include_archived,
            includeChildren: args.include_children,
            includeTmp: args.include_tmp,
          });
          return { content: JSON.stringify(result) };
        },
      });
    });
  },
});
