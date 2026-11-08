const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the component's real ES modules with Vela system APIs supplied by tests.
function loadModule(filename, systemModules = {}) {
  const context = { console };
  let source = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('.ux')) source = source.split('<script>')[1].split('</script>')[0];
  source = source.replace(/^import (.+) from ['"](.+)['"];?\s*$/gm, (_, binding, specifier) => {
    const dependency = specifier.startsWith('.')
      ? loadModule(path.resolve(path.dirname(filename), specifier), systemModules)
      : systemModules[specifier];
    if (!dependency) throw new Error('Missing test system API: ' + specifier);
    if (binding.startsWith('{')) {
      for (const name of binding.slice(1, -1).split(',').map(name => name.trim())) {
        context[name] = dependency[name];
      }
    } else context[binding] = dependency.default;
    return '';
  });
  const names = [];
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_, list) => {
    names.push(...list.split(',').map(name => name.trim()));
    return '';
  });
  if (source.includes('export default')) {
    source = source.replace('export default', 'const defaultExport =');
    names.push('default: defaultExport');
  }
  return vm.runInNewContext(source + '\n;({' + names.join(',') + '})', context, { filename });
}

module.exports = { loadModule };
