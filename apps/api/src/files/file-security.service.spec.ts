import { createServer, type Server, type Socket } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { FileSecurityService, MAX_UPLOAD_BYTES } from './file-security.service';
import type { Env } from '../config/env.validation';

describe('bounded content validation and ClamD protocol', () => {
  let server: Server;
  let service: FileSecurityService;
  let connections: number;
  let verdict: string;
  let received: Buffer[];
  const sockets = new Set<Socket>();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  const opus = Buffer.alloc(64);
  opus.write('OggS');
  opus.write('OpusHead', 28);
  const webm = Buffer.from('1a45dfa3874282847765626d', 'hex');
  const mp4 = Buffer.alloc(32);
  mp4.writeUInt32BE(24);
  mp4.write('ftypisom', 4);
  const m4a = Buffer.from(mp4);
  m4a.write('M4A ', 8);
  const wav = Buffer.alloc(64);
  wav.write('RIFF');
  wav.writeUInt32LE(56, 4);
  wav.write('WAVE', 8);

  beforeEach(async () => {
    connections = 0;
    verdict = 'stream: OK\0';
    received = [];
    server = createServer((socket) => {
      sockets.add(socket);
      connections++;
      let bytes = Buffer.alloc(0),
        command = false;
      const chunks: Buffer[] = [];
      socket.on('data', (chunk) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (!command) {
          const end = bytes.indexOf(0);
          if (end < 0) return;
          expect(bytes.subarray(0, end).toString()).toBe('zINSTREAM');
          bytes = bytes.subarray(end + 1);
          command = true;
        }
        while (bytes.length >= 4) {
          const length = bytes.readUInt32BE(0);
          expect(length).toBeLessThanOrEqual(65536);
          if (bytes.length < 4 + length) return;
          if (length === 0) {
            received.push(Buffer.concat(chunks));
            socket.end(verdict);
            return;
          }
          chunks.push(bytes.subarray(4, 4 + length));
          bytes = bytes.subarray(4 + length);
        }
      });
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('fixture listen failed');
    service = new FileSecurityService({
      get: (key: string) =>
        key === 'CLAMAV_HOST' ? '127.0.0.1' : address.port,
    } as ConfigService<Env, true>);
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('validates real bytes before sending a bounded INSTREAM request', async () => {
    const input = Buffer.concat([pdf, Buffer.alloc(150000, 32)]);
    await expect(
      service.validate(
        'ticket-attachments',
        input,
        'fixture.pdf',
        'application/pdf',
      ),
    ).resolves.toBe('application/pdf');
    expect(received).toEqual([input]);
  });
  it('accepts UTF-8 text and normalizes generic content types', async () => {
    await expect(
      service.validate(
        'ticket-attachments',
        Buffer.from('Registro de teste sem dados reais.'),
        'fixture.log',
        'application/octet-stream',
      ),
    ).resolves.toBe('text/plain');
  });
  it.each([
    [opus, 'voice.ogg', 'audio/ogg; codecs=opus', 'audio/ogg'],
    [opus, 'voice.opus', 'audio/opus', 'audio/ogg'],
    [webm, 'voice.webm', 'audio/webm;codecs=opus', 'audio/webm'],
    [webm, 'video.webm', 'video/webm', 'video/webm'],
    [mp4, 'video.mp4', 'video/mp4', 'video/mp4'],
    [m4a, 'voice.m4a', 'audio/mp4', 'audio/mp4'],
    [wav, 'voice.wav', 'audio/wav', 'audio/wav'],
  ])(
    'scans approved voice/video bytes for %s / %s',
    async (bytes, name, declared, mime) => {
      await expect(
        service.validate(
          'ticket-attachments',
          bytes as Buffer,
          name,
          declared,
        ),
      ).resolves.toBe(mime);
      expect(connections).toBe(1);
      expect(received).toEqual([bytes]);
    },
  );
  it('never stores a voice attachment that the antivirus rejects', async () => {
    verdict = 'stream: Synthetic.Test.Signature FOUND\0';
    await expect(
      service.validate('ticket-attachments', opus, 'voice.ogg', 'audio/ogg'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    [Buffer.from('MZ' + 'x'.repeat(100)), 'fake.pdf', 'application/pdf'],
    [
      Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>'),
      'fake.txt',
      'text/plain',
    ],
    [Buffer.from('<svg onload="alert(1)"></svg>'), 'fake.svg', 'image/svg+xml'],
    [
      Buffer.from(
        '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>',
      ),
      'fake.xml',
      'application/xml',
    ],
    [Buffer.from([0, 1, 2, 3, 4, 5]), 'fake.txt', 'text/plain'],
    [Buffer.from('{"unterminated":'), 'fake.json', 'application/json'],
    [pdf, 'fake.png', 'image/png'],
    [pdf, 'fixture.pdf', 'text/html'],
    [pdf, 'payload.exe', 'application/pdf'],
  ])(
    'rejects disguised or active file %s / %s before opening the scanner',
    async (bytes, filename, mime) => {
      await expect(
        service.validate('ticket-attachments', bytes, filename, mime),
      ).rejects.toMatchObject({ status: 400 });
      expect(connections).toBe(0);
    },
  );
  it('enforces actual byte lengths, bucket limits and destination allowlist', async () => {
    await expect(
      service.validate(
        'ticket-attachments',
        Buffer.alloc(MAX_UPLOAD_BYTES + 1),
        'large.pdf',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.validate(
        'apticket-profile-avatars',
        Buffer.alloc(2 * 1024 * 1024 + 1),
        'large.png',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.validate('foreign-app-bucket', pdf, 'fixture.pdf'),
    ).rejects.toMatchObject({ status: 400 });
    expect(connections).toBe(0);
  });
  it.each([
    'stream: Synthetic.Test.Signature FOUND\0',
    'stream: Heuristics.Limits.Exceeded FOUND\0',
    'stream: Heuristics.Encrypted.Zip FOUND\0',
  ])('rejects an infected, encrypted or scan-limit verdict', async (reply) => {
    verdict = reply;
    await expect(
      service.validate('ticket-attachments', pdf, 'fixture.pdf'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each(['stream: scan failed ERROR\0', 'unrecognized reply\0', ''])(
    'fails closed on scanner errors and incomplete results',
    async (reply) => {
      verdict = reply;
      await expect(
        service.validate('ticket-attachments', pdf, 'fixture.pdf'),
      ).rejects.toMatchObject({ status: 503 });
    },
  );
  it('fails closed when the scanner is offline', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(
      service.validate('ticket-attachments', pdf, 'fixture.pdf'),
    ).rejects.toMatchObject({ status: 503 });
  });
});
