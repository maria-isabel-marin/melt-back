import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool | null = null;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    console.log("Cargando base de datos desde:", databaseUrl); // <-- Agrega esta línea para depuración
    if (!databaseUrl) {
      // No DB URL: use default PrismaClient
      super();
      return;
    }

    // Configuración optimizada para bases de datos en la nube
    const localPool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const adapter = new PrismaPg(localPool);
    // Call super with adapter before accessing `this`
    super({ adapter });
    // assign to instance after super()
    this.pool = localPool;
  }

  async onModuleInit() {
    if (!process.env.DATABASE_URL) {
      this.logger.error('DATABASE_URL no está definida en las variables de entorno (.env)');
      return;
    }

    try {
      await this.$connect();
      this.logger.log('Conexión a la base de datos establecida correctamente');
    } catch (error: unknown) {
      this.logger.error('Error al conectar con la base de datos. Verifica tu URL y permisos de IP.');
      if (error instanceof Error) {
        this.logger.error(error.message);
      } else {
        this.logger.error(String(error));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (this.pool) {
      await this.pool.end();
      this.logger.log('Pool de conexiones cerrado');
    }
  }
}