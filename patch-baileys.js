/**
 * Patches Baileys to spoof an Android frankel device (v2.26.16.73).
 * This is required for view-once bypass to work.
 * Run automatically via postinstall / prestart.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'

const TARGET = './node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'

if (!existsSync(TARGET)) {
    console.error(`[patch-baileys] ✗ Target not found: ${TARGET}`)
    console.error('  Run: npm install')
    process.exit(1)
}

let src = readFileSync(TARGET, 'utf-8')

// 1. Add crypto import if missing
if (!src.includes('import crypto') && !src.includes('import { randomUUID }')) {
    src = `import crypto from 'crypto';\n` + src
}

// 2. getUserAgent → Android frankel
const newUserAgent = `const getUserAgent = (config) => {
    return {
        appVersion: { primary: 2, secondary: 26, tertiary: 16, quaternary: 73 },
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
`
src = src.replace(/const getUserAgent = \(config\) => \{[\s\S]*?const PLATFORM_MAP/, newUserAgent + 'const PLATFORM_MAP')

// 3. getWebInfo → undefined (no web info for Android)
const newWebInfo = `const getWebInfo = (config) => { return undefined; };\n`
src = src.replace(/const getWebInfo = \(config\) => \{[\s\S]*?const getClientPayload/, newWebInfo + 'const getClientPayload')

// 4. getClientPayload
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
`
src = src.replace(/const getClientPayload = \(config\) => \{[\s\S]*?export const generateLoginNode/, newClientPayload + 'export const generateLoginNode')

// 5. getPlatformType → ANDROID_PHONE
const newGetPlatformType = `const getPlatformType = (platform) => {
    return proto.DeviceProps.PlatformType.ANDROID_PHONE;
};
`
src = src.replace(/const getPlatformType = \(platform\) => \{[\s\S]*?export const generateRegistrationNode/, newGetPlatformType + 'export const generateRegistrationNode')

writeFileSync(TARGET, src)
console.log('✅ patch-baileys: Baileys patched → Android frankel v2.26.16.73')
