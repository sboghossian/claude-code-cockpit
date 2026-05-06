import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

export interface SettingsFileView {
  filePath: string;
  exists: boolean;
  data: Record<string, unknown> | undefined;
  parseError: string | undefined;
}

export interface ManageState {
  globalSettings: SettingsFileView;
  localSettings: SettingsFileView;
  hookEvents: string[];
  mcpServers: string[];
  enabledPlugins: string[];
  topLevelKeys: string[];
  agentsDir: string;
  scheduledTasksDir: string;
  skillsDir: string;
}

const HOME = os.homedir();

function readJsonFile(filePath: string): SettingsFileView {
  if (!fs.existsSync(filePath)) {
    return { filePath, exists: false, data: undefined, parseError: undefined };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    logger.warn(`readJsonFile: cannot read ${filePath}: ${String(err)}`);
    return { filePath, exists: true, data: undefined, parseError: String(err) };
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return { filePath, exists: true, data, parseError: undefined };
  } catch (err) {
    return { filePath, exists: true, data: undefined, parseError: `Invalid JSON: ${String(err)}` };
  }
}

export function readManageState(): ManageState {
  const global = readJsonFile(path.join(HOME, '.claude', 'settings.json'));
  const local = readJsonFile(path.join(HOME, '.claude', 'settings.local.json'));

  const merged = { ...(global.data || {}), ...(local.data || {}) };
  const topLevelKeys = Object.keys(merged).sort();

  const hookEvents: string[] = [];
  const hooks = merged.hooks;
  if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
    hookEvents.push(...Object.keys(hooks).sort());
  }

  const mcpServers: string[] = [];
  const mcp = merged.mcpServers;
  if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
    mcpServers.push(...Object.keys(mcp).sort());
  }

  const enabledPlugins: string[] = [];
  const plugins = merged.enabledPlugins;
  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    enabledPlugins.push(...Object.keys(plugins).sort());
  }

  return {
    globalSettings: global,
    localSettings: local,
    hookEvents,
    mcpServers,
    enabledPlugins,
    topLevelKeys,
    agentsDir: path.join(HOME, '.claude', 'agents'),
    scheduledTasksDir: path.join(HOME, '.claude', 'scheduled-tasks'),
    skillsDir: path.join(HOME, '.claude', 'skills'),
  };
}
