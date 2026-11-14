import { Plugin } from '@opencode/plugin';
import { generateImage } from '../../lib/image-gen.js';

const DESCRIPTION =
  'Generates or edits an image from a text prompt and writes it to disk, returning the file path, pixel dimensions, format and byte size. Defaults to a6api\'s nano-banana-2.1 ($0.0054-0.0061 per image, 10-24 s, JPEG; a size such as 1024x1024 or 1792x1024 is mapped by the gateway to an aspect, and 1024x1792 comes back 1536x2752). Pass `images` to edit or restyle an existing picture instead of creating one. Use it whenever the user asks for a picture; do not ask before calling it for a picture the user already asked for.';

export default Plugin.define({
  id: 'image-gen',
  async setup(ctx) {
    const directory = ctx.location.directory;

    await ctx.tool.transform((editor) => {
      editor.add({
        name: 'image_generate',
        description: DESCRIPTION,
        input: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'What to draw, or for an edit, what to change. Chinese is fine.',
            },
            path: {
              type: 'string',
              description: 'Destination file, relative to the session directory or absolute. The real extension is applied from the returned format. Defaults to generated/<timestamp>-<prompt-slug>.<ext>.',
            },
            size: {
              type: 'string',
              description: 'Requested size, e.g. 1024x1024, 1792x1024 (landscape), 1024x1792 (portrait). The gateway translates it into an aspect ratio.',
            },
            images: {
              type: 'array',
              items: { type: 'string' },
              description: 'Local paths or http(s) URLs used to edit the picture or as style/subject references. The gateway\'s image-to-image endpoint is used when this is set.',
            },
            model: {
              type: 'string',
              description: 'Override the image model. Only nano-banana-2.1 is authorised on the current a6api token.',
            },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
        async execute(input) {
          const result = await generateImage({ ...input, cwd: directory });
          return { content: JSON.stringify(result) };
        },
      });
    });
  },
});
