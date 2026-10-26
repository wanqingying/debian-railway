import { Plugin } from '@opencode/plugin';
import { collectSystemInfo } from '../../lib/sysinfo.js';

const DESCRIPTION =
  'Reports facts about the machine this session runs on: current time and timezone, OS/distro/kernel, shell, user, locale, container/CI flags plus the container\'s own start time and uptime, the CPU/memory/pids quota this process actually gets (cgroup limits, deliberately not the host CPU count), disk, configured and listening ports split into externally reachable and loopback-only with the Railway public TCP proxy and HTTP domain, the platform (Railway project/service/region/deployment/volume), the active Python venv, and installed developer tools with versions. Use it whenever a task depends on those facts.';

// OpenCode 2 registers tools from plugins; a `tools/<name>.ts` file is not a
// discovery path (verified against 2.1.4: a file there is never read, while the
// same file under plugins/ loads). The tool is declared once per location, so
// the workspace directory is captured here and reused by every call.
export default Plugin.define({
  id: 'sysinfo',
  async setup(ctx) {
    const directory = ctx.location.directory;

    await ctx.tool.transform((editor) => {
      editor.add({
        name: 'sysinfo',
        description: DESCRIPTION,
        input: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute() {
          return { content: JSON.stringify(collectSystemInfo({ diskTarget: directory })) };
        },
      });
    });
  },
});
