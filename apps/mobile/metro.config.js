// Monorepo Metro config.
//
// The workspace packages ship TypeScript source rather than a build, so Metro
// has to watch the repo root and resolve modules from both node_modules trees.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
// The @kiwi/* packages point their "exports" at .ts source.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
