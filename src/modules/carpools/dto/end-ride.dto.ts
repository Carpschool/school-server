import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class EndRideDto {
  @ApiProperty({ description: 'Single GPS latitude read at arrival', example: 49.2606 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Single GPS longitude read at arrival', example: -123.2460 })
  @IsNumber()
  longitude: number;
}
