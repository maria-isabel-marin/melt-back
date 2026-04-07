import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CorpusService } from './corpus.service';
import { CreateCorpusDto } from './dto/create-corpus.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@Controller('corpus')
@UseGuards(JwtAuthGuard)
export class CorpusController {
  constructor(private service: CorpusService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAllByUser(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOne(id, user.sub);
  }

  @Post()
  create(@Body() dto: CreateCorpusDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(user.sub, dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateCorpusDto>, @CurrentUser() user: JwtPayload) {
    return this.service.update(id, user.sub, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.sub);
  }
}
