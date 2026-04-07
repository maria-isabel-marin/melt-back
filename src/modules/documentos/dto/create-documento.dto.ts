import { TipoDocumento, Idioma } from '@prisma/client';

export class CreateDocumentoDto {
  corpusId: string;
  titulo: string;
  descripcion?: string;
  autor?: string;
  tipoDocumento?: TipoDocumento;
  idioma: Idioma;
  nroPaginas?: number;
  fileUrl?: string;
}
