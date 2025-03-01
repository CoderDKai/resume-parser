import dotenv from 'dotenv';
import { ImapConfig, ImapClient } from '@/utils';

dotenv.config();

const config: ImapConfig = {
  user: process.env.EMAIL_USER || '',
  password: process.env.EMAIL_PASSWORD || '',
  host: process.env.EMAIL_HOST || '',
  port: parseInt(process.env.EMAIL_PORT || '993'),
  tls: true,
}

async function main() {
  const client = new ImapClient(config);
  try {
    await client.connect();
    const mails = await client.getMailList('简历', {
      limit: 1,
    });
    await client.downloadAttachments(mails);
  } catch (error) {
    console.error('获取邮件列表失败:', error);
  } finally {
    client.disconnect();
  }
}

main();