"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAppBranding = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DEFAULT_BRANDING = {
    name: 'Forkline',
    tagline: 'Run and control coding agents in isolated Git worktrees.',
    logoFile: 'logo.svg',
    appIconFile: 'logo.icns'
};
const sanitizeText = (value, fallback) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
};
const sanitizeLogoFile = (value) => {
    const normalized = sanitizeText(value, DEFAULT_BRANDING.logoFile)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    if (!normalized || normalized.includes('..'))
        return DEFAULT_BRANDING.logoFile;
    return normalized;
};
const parseBranding = (input) => {
    const source = (input && typeof input === 'object') ? input : {};
    return {
        name: sanitizeText(source.name, DEFAULT_BRANDING.name),
        tagline: sanitizeText(source.tagline, DEFAULT_BRANDING.tagline),
        logoFile: sanitizeLogoFile(source.logoFile),
        appIconFile: sanitizeLogoFile(source.appIconFile)
    };
};
const resolveBrandingConfigPath = () => {
    const candidates = [
        path_1.default.resolve(process.cwd(), 'config/app-branding.json'),
        path_1.default.resolve(__dirname, '../../config/app-branding.json')
    ];
    for (const candidate of candidates) {
        try {
            if (fs_1.default.existsSync(candidate))
                return candidate;
        }
        catch {
            // Ignore unreadable path and continue.
        }
    }
    return null;
};
const loadAppBranding = () => {
    const configPath = resolveBrandingConfigPath();
    if (!configPath)
        return DEFAULT_BRANDING;
    try {
        const raw = fs_1.default.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parseBranding(parsed);
    }
    catch {
        return DEFAULT_BRANDING;
    }
};
exports.loadAppBranding = loadAppBranding;
