import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { MetadataService } from './metadata.service';

@ApiTags('metadata')
@Controller('api/v1/meta')
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get()
  @ApiOperation({
    summary: 'Public School Server Metadata with Ed25519 Digital Signature',
    description:
      'Returns school metadata (name, code, domains, campus coordinates). The response is signed with the School Server Ed25519 private key in the x-school-signature HTTP response header for automated Central Server admin onboarding.',
  })
  @ApiResponse({ status: 200, description: 'Signed school metadata' })
  getMetadata(@Res() res: Response) {
    const { payloadObj, signatureBase64 } = this.metadataService.getSignedMetadata();

    // Attach cryptographic Ed25519 signature in HTTP header
    res.setHeader('x-school-signature', signatureBase64);
    res.setHeader('Content-Type', 'application/json');

    return res.status(HttpStatus.OK).json(payloadObj);
  }
}
