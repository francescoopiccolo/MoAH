// Opt-in adapter for Pi 0.85.1 stateless workers. Functions delegate to upstream.
// Unrecognized exports load the complete original SDK; native Pi is unaffected.
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { existsSync } = require('node:fs');
const upstreamRequire = createRequire(__filename);
const entry = upstreamRequire.resolve.paths('@earendil-works/pi-coding-agent')
  .map(base => join(base, '@earendil-works/pi-coding-agent/dist/index.js')).find(existsSync);
if (!entry) throw new Error('Pinned Pi SDK not found');
const root = dirname(entry);
const from = path => upstreamRequire(join(root, path));
let fullSdk;
const exportsCache = {
  __esModule: true,
  defineTool: from('core/extensions/types.js').defineTool,
  formatSize: from('core/tools/truncate.js').formatSize,
  keyHint: (...args) => from('modes/interactive/components/keybinding-hints.js').keyHint(...args),
};
module.exports = new Proxy(exportsCache, {
  get(target, name) {
    if (name === 'then' || name === '__JITI_ERROR__' || name === 'default') return undefined;
    if (name in target) return target[name];
    fullSdk ??= require('jiti').createJiti(__filename, { fsCache: false })(entry);
    return fullSdk[name];
  },
});
