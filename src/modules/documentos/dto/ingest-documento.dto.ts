import { DocumentType, Language } from '@prisma/client';

export class IngestDocumentoDto {
  corpusId!: string;
  title!: string;
  content!: string; // El texto bruto a procesar
  author?: string;
  documentType?: DocumentType;
  language!: Language;
  description?: string;
}