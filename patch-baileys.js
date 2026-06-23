/**
 * Reverting to frankel profile (v2.26.16.73)
 * Baileys 6.7.9 üçün uyğunlaşdırılmışdır
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Baileys 6.7.9 üçün mümkün yollar
const possiblePaths = [
    './node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js',
    './node_modules/@whiskeysockets/baileys/src/Utils/validate-connection.js'
];

let TARGET = null;
for (const path of possiblePaths) {
    try {
        const fullPath = join(__dirname, path);
        if (existsSync(fullPath)) {
            TARGET = fullPath;
            break;
        }
    } catch (e) {}
}

if (!TARGET) {
    console.log('⚠️ validate-connection.js not found, skipping patch');
    process.exit(0);
}

let src = readFileSync(TARGET, 'utf-8');

// 1. Add crypto import if missing
if (!src.includes("import crypto") && !src.includes("import { randomUUID }")) {
    src = `import crypto from 'crypto';\n` + src;
}

// 2. Force replacement of getUserAgent
const newUserAgent = `const getUserAgent = (config) => {
    return {
        appVersion: {
            primary: 2,
            secondary: 26,
            tertiary: 16,
            quaternary: 73
        },
        platform: proto.ClientPayload.UserAgent.Platform.ANDROID,
        releaseChannel: proto.ClientPayload.UserAgent.ReleaseChannel.RELEASE,
        osVersion: '16',
        manufacturer: 'Google',
        device: 'frankel',
        osBuildNumber: 'CP1A.260405.005',
        deviceBoard: 'frankel',
        deviceType: proto.ClientPayload.UserAgent.DeviceType.PHONE,
        phoneId: crypto.randomUUID(),
        localeLanguageIso6391: 'en',
        mnc: '001',
        mcc: '310',
        localeCountryIso31661Alpha2: 'US'
    };
};
`;
src = src.replace(/const getUserAgent = \(config\) => \{[\s\S]*?const PLATFORM_MAP/, newUserAgent + 'const PLATFORM_MAP');

// 3. Force replacement of getWebInfo
const newWebInfo = `const getWebInfo = (config) => {
    return undefined;
};
`;
src = src.replace(/const getWebInfo = \(config\) => \{[\s\S]*?const getClientPayload/, newWebInfo + 'const getClientPayload');

// 4. Force replacement of getClientPayload
const newClientPayload = `const getClientPayload = (config) => {
    const payload = {
        connectType: proto.ClientPayload.ConnectType.WIFI_UNKNOWN,
        connectReason: proto.ClientPayload.ConnectReason.USER_ACTIVATED,
        userAgent: getUserAgent(config)
    };
    const webInfo = getWebInfo(config);
    if (webInfo) payload.webInfo = webInfo;
    return payload;
};
`;
src = src.replace(/const getClientPayload = \(config\) => \{[\s\S]*?export const generateLoginNode/, newClientPayload + 'export const generateLoginNode');

// 5. Force replacement of getPlatformType
const newGetPlatformType = `const getPlatformType = (platform) => {
    return proto.DeviceProps.PlatformType.ANDROID_PHONE;
};
`;
src = src.replace(/const getPlatformType = \(platform\) => \{[\s\S]*?export const generateRegistrationNode/, newGetPlatformType + 'export const generateRegistrationNode');

writeFileSync(TARGET, src);

console.log('--------------------------------------------------');
console.log('SUCCESS: Baileys patched successfully (Frankel Mode).');
console.log(`Target: ${TARGET}`);
console.log('Current Spoof: Android, frankel, v2.26.16.73');
console.log('--------------------------------------------------\n');