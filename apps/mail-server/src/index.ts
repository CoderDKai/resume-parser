import Imap from 'imap';
import dotenv from 'dotenv';

dotenv.config();

// 配置接口
interface ImapConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}

interface Mail {
  id: string;
  from: string;
  subject: string;
  date: Date;
}

// IMAP客户端类
class ImapCline {
  private config: ImapConfig;
  private imap: Imap;

  constructor(config: ImapConfig) {
    this.config = config;
    this.imap = new Imap({
      ...config,
      tlsOptions: {
        rejectUnauthorized: false,
      },
    });
  }

  // 连接到服务器
  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => resolve());
      this.imap.once('error', err => reject(err));
      this.imap.connect();
    });
  }

  // 断开链接
  public disconnect(): void {
    this.imap.end();
  }

  // 获取邮件列表
  public async getMailList(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          reject(err);
          return
        }

        const f = this.imap.seq.fetch('1: 10', {
          bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
          struct: true,
        });

        f.on('message', (msg, seqno) => {
          console.log('message', seqno);
          
          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf-8');
            });

            stream.once('end', () => {
              const header = Imap.parseHeader(buffer);
              console.log('发件人:', header.from[0]);
              console.log('收件人:', header.to[0]);
              console.log('主题:', header.subject[0]);
              console.log('日期:', header.date[0]);
              console.log('------------------------');
            });
          })
        })

        f.once('error', reject);
        f.once('end', () => {
          console.log('获取邮件列表完成');
          resolve();
        });
      })
    })
  }
}

const config: ImapConfig = {
  user: process.env.EMAIL_USER || '',
  password: process.env.EMAIL_PASSWORD || '',
  host: process.env.EMAIL_HOST || '',
  port: parseInt(process.env.EMAIL_PORT || '993'),
  tls: true,
}

async function main() {
  const client = new ImapCline(config);
  try {
    await client.connect();
    await client.getMailList();
  } catch (error) {
    console.error('获取邮件列表失败:', error);
  } finally {
    client.disconnect();
  }
}

main();