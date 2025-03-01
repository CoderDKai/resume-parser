import Imap, { type MailBoxes, type SortCriteria } from 'imap';
import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';

// 配置接口
export interface ImapConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}

interface FilterParams {
  limit?: number;
  timeRange?: 'today' | 'yesterday' | 'thisWeek' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom';
}

interface Mail {
  // 邮件唯一标识符
  uid: number;
  // 序列号
  seqNo: number;
  // 头部信息
  headers: { [key: string]: string[] };
  // 主题
  subject: string;
  // 发件人
  from: string;
  // 收件人
  to: string;
  // 日期
  date: string;
  // 纯文本正文
  text?: string;
  // HTML 正文
  html?: string;
  // 附件信息
  attachments: {
    filename?: string;
    contentType: string;
    size: number;
    partID: string;
    content: Buffer;
  }[];
}

// IMAP客户端类
export class ImapClient {
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
      this.imap.once('ready', resolve);
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  // 断开链接
  public disconnect(): void {
    this.imap.end();
  }
  // 获取文件夹列表
  public async getFolderList(): Promise<MailBoxes> {
    return new Promise((resolve, reject) => {
      this.imap.getBoxes((err, boxes) => {
        if (err) {
          reject(err);
          return
        }

        resolve(boxes);
      })
    })
  }

  // 构建筛选条件
  private buildSearchCriteria(filterParams: FilterParams) {
    const { timeRange } = filterParams;
    const searchCriteria: any[] = ['ALL'];
    if (!timeRange) {
      return searchCriteria
    }
    const now = new Date();
    let sinceDate: Date;

    // IMAP 日期格式：DD-MMM-YYYY
    const formatDate = (date: Date): string => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${date.getDate().toString().padStart(2, '0')}-${months[date.getMonth()]}-${date.getFullYear()}`;
    };

    switch (timeRange) {
      case 'today':
        sinceDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'yesterday':
        sinceDate = new Date(now.setDate(now.getDate() - 1));
        sinceDate.setHours(0, 0, 0, 0);
        break;
      case 'thisWeek':
        sinceDate = new Date(now.setDate(now.getDate() - now.getDay())); // 周日开始
        break;
      case 'last7days':
        sinceDate = new Date(now.setDate(now.getDate() - 6)); // 包括今天
        break;
      case 'thisMonth':
        sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'lastMonth':
        sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
      default:
        throw new Error('无效的时间范围');
    }

    searchCriteria.push(['SINCE', formatDate(sinceDate)]);
    return searchCriteria;
  }

  // 解析 RFC2047 编码
  private decodeRFC2047(encoded: string): string {
    const parts = encoded.split(/(?=\=\?[A-Za-z0-9-]+\?[BQ]\?)/);
    let decoded = '';

    for (const part of parts) {
      const match = part.match(/=\?(.+?)\?([BQ])\?(.+?)\?=/);
      if (!match) {
        decoded += part;
        continue;
      }

      const [, charset, encoding, content] = match;
      if (encoding.toUpperCase() === 'B') {
        decoded += Buffer.from(content, 'base64').toString(charset.toLowerCase() === 'utf-8' ? 'utf8' : 'ascii');
      } else if (encoding.toUpperCase() === 'Q') {
        decoded += content.replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
    }

    return decoded.trim();
  }

  // 查找附件
  private findAttachments(struct: any[], attachments: { filename?: string; contentType: string; size: number; partID: string; content: Buffer }[]) {
    const processPart = (part: any) => {
      if (Array.isArray(part)) {
        part.forEach(subPart => processPart(subPart)); // 递归处理嵌套数组
      } else if (part && typeof part === 'object') {
        // 只处理真正的附件部分
        if (part.disposition?.type?.toUpperCase() === 'ATTACHMENT' && part.partID) {
          let rawFilename = part.params?.filename || part.params?.name;
          const filename = rawFilename && rawFilename !== '/' 
            ? this.decodeRFC2047(rawFilename) 
            : undefined;
          attachments.push({
            filename,
            contentType: `${part.type}/${part.subtype}`,
            size: part.size || 0,
            partID: part.partID,
            content: part.content,
          });
        }
        // 如果有子部分，继续递归
        if (part.parts) {
          processPart(part.parts);
        }
      }
    };

    struct.forEach(part => processPart(part));
  }

  // 获取邮件列表
  public async getMailList(folderName: string = 'INBOX', filterParams: FilterParams = {}): Promise<Mail[]> {
    const { limit } = filterParams;
    return new Promise((resolve, reject) => {
      this.imap.openBox(folderName, true, (err, box) => {
        if (err) {
          return reject(err);
        }
        const searchCriteria = this.buildSearchCriteria(filterParams);
        this.imap.search(searchCriteria, (err, results) => {
          if (err) {
            return reject(err);
          }
          if (results.length === 0) {
            return resolve([]);
          }
          const fetchUids = results.slice(0, limit);
          const f = this.imap.fetch(fetchUids, {
            bodies: '',
            struct: true,
          })
          const mails: Mail[] = [];
          f.on('message', (msg, seqNo) => {
            const mail: Partial<Mail> = {
              seqNo,
              attachments: [],
            }
            msg.on('body', (stream) => {
              let buffer = Buffer.alloc(0);
              stream.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
              })
              stream.once('end', async () => {
                try {
                  const parsed = await simpleParser(buffer);
                  mail.uid = parsed.messageId ? fetchUids[mails.length] : seqNo;
                  mail.headers = parsed.headers;
                  mail.subject = parsed.subject || 'N/A';
                  mail.from = parsed.from?.text || 'N/A';
                  mail.to = parsed.to?.text || 'N/A';
                  mail.date = parsed.date?.toISOString() || 'N/A';
                  mail.text = parsed.text;
                  mail.html = parsed.html;

                  // 直接使用 simpleParser 的 attachments
                  if (parsed.attachments) {
                    mail.attachments = parsed.attachments.map(att => ({
                      filename: att.filename,
                      contentType: att.contentType,
                      size: att.size,
                      partID: undefined, // 不再需要 partID
                      content: att.content // 直接获取内容
                    }));
                  }
                  mails.push(mail as Mail); // 在解析完成时加入数组
                } catch (parseErr) {
                  console.error(`解析邮件 #${seqNo} 失败:`, parseErr);
                }
              });
            })

            msg.on('attributes', (attrs) => {
              mail.uid = attrs.uid;
            })
          });

          f.once('error', reject);
          f.once('end', () => {
            // 添加短暂延迟以确保所有消息都已处理
            setTimeout(() => {
              resolve(mails);
            }, 100);
          });
        })
      })
    })
  }

  // 清理文件名中的非法字符
  private sanitizeFilename(name: string): string {
    return name.replace(/[<>:;"\/\\|?*]+/g, '_').substring(0, 100);
  }
  // 下载邮件列表中的附件
  // 修改 downloadAttachments，使用解析后的附件内容
  public async downloadAttachments(mails: Mail[], outputDir: string = './attachments'): Promise<void> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const mail of mails) {
      if (!mail.attachments || mail.attachments.length === 0) {
        continue;
      }

      for (const att of mail.attachments) {
        try {
          const content = att.content; // 直接使用解析后的内容
          const filename = att.filename && att.filename !== '/' 
            ? att.filename 
            : `attachment_${mail.uid}_${Date.now()}`; // 避免重复，使用时间戳
          const safeFilename = this.sanitizeFilename(filename);
          const filepath = path.join(outputDir, safeFilename);

          fs.writeFileSync(filepath, content);
        } catch (err) {
          console.error(`保存附件失败（邮件 #${mail.seqNo}，${att.filename}）:`, err);
        }
      }
    }
  }
}