import { DocumentType, Language } from '@prisma/client';

export class CreateDocumentoDto {
  corpusId: string;
  title: string;
  description?: string;
  author?: string;
  documentType?: DocumentType;
  language: Language;
  pageCount?: number;
  fileUrl?: string;
}
