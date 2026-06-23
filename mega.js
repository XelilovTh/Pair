import { Storage } from 'megajs'

const auth = {
    email: process.env.MEGA_EMAIL || '',
    password: process.env.MEGA_PASSWORD || '',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export const upload = async (data, name) => {
    if (!auth.email || !auth.password) {
        throw new Error('MEGA_EMAIL and MEGA_PASSWORD env vars are required')
    }
    if (typeof data === 'string') data = Buffer.from(data)
    const storage = await new Storage({ ...auth }).ready
    try {
        const file = await storage.upload({ name, size: data.length }, data).complete
        const url = await file.link()
        return url
    } finally {
        storage.close()
    }
}
