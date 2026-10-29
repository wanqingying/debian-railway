import { Plugin } from '@opencode/plugin';
import { searchSessions } from '../../lib/session-search.js';

const DESCRIPTION =
  'Finds which past opencode sessions dealt with something. Give it a keyword from a task, error, ticket, service or feature name and it returns one row per session — id, title, directory, last activity, how many times the term occurred in the conversation, and a short snippet — so you can answer "who already handled this, and what did they conclude?" before re-doing the work. Searches user messages and assistant replies of every project on this machine, not just the current one. Tool output is NOT searched: a clue that only ever appeared in a shell result or log dump will not be found. Defaults already exclude archived sessions, subagent sessions and /tmp scratch work; widen them only when the narrow search comes back empty.';

// The SDK types `execute` args as `unknown` whenever the input is a plain JSON Schema (only an
// effect Schema or StandardSchema carries its type through), so the shape is declared here. The
// schema below stays the source of truth for the model — this is the TypeScript half of it.
interface SessionSearchInput {
  query: string;
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
              description: 'Keyword to look for. Case-insensitive; CJK works as written.',
            },
            match: {
              type: 'string',
              enum: ['title', 'content', 'both'],
              description: "Where to look. 'content' (default) searches what was written, 'title' only session titles, 'both' unions them.",
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
          required: ['query'],
          additionalProperties: false,
        },
        async execute(rawArgs) {
          const args = (rawArgs ?? {}) as SessionSearchInput;
          const result = await searchSessions({
            query: args.query,
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
