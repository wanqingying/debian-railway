import { tool } from '@opencode-ai/plugin';
import { collectSystemInfo } from '../lib/sysinfo.js';

const DESCRIPTION = 'Reports facts about the machine this session runs on: current time and timezone, OS/distro/kernel, shell, user, locale, container/CI flags, CPU/memory/disk, active Python venv, and installed developer tools with versions. Use it whenever a task depends on those facts.';

export default tool({
  description: DESCRIPTION,
  args: {},
  async execute(_args, context) {
    return JSON.stringify(collectSystemInfo({ diskTarget: context?.directory }));
  },
});
