import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  getRootAbsolutePath(): string {
    const root = this.config.get<string>('STORAGE_ROOT') ?? './storage';
    return path.resolve(process.cwd(), root);
  }

  buildRelativePath(year: number, concesionarioCode: string, consecutivo: number, filename: string) {
    // Guardamos en DB con "/" para que sea portable
    return `${year}/${concesionarioCode}/${consecutivo}/${filename}`;
  }

  absolutePathFromRelative(relativePath: string): string {
    // Convierte la ruta relativa (con /) a ruta del SO
    const root = this.getRootAbsolutePath();
    const safeParts = relativePath.split('/'); // relativo viene con /
    return path.join(root, ...safeParts);
  }

  async ensureDirForRelativePath(relativePath: string) {
    const full = this.absolutePathFromRelative(relativePath);
    const dir = path.dirname(full);
    await fs.mkdir(dir, { recursive: true });
  }

  async writeFile(relativePath: string, buffer: Buffer) {
    await this.ensureDirForRelativePath(relativePath);
    const full = this.absolutePathFromRelative(relativePath);
    await fs.writeFile(full, buffer);
  }

  async deleteFileIfExists(relativePath: string) {
    try {
      const full = this.absolutePathFromRelative(relativePath);
      await fs.unlink(full);
    } catch {
      // no-op
    }
  }

  createStream(relativePath: string) {
    const full = this.absolutePathFromRelative(relativePath);
    return createReadStream(full);
  }
}
