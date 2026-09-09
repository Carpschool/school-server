import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

export class CreateHomeDto {
  @ApiProperty({ description: 'Location label', example: 'Primary Home' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ description: 'Street address', example: '1234 Student Way, Vancouver, BC' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ description: 'Latitude', example: 49.2606 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Longitude', example: -123.2460 })
  @IsNumber()
  longitude: number;

  @ApiProperty({
    description: 'Walking radius in meters (between 10m and 200m)',
    example: 75,
    minimum: 10,
    maximum: 200,
  })
  @IsNumber()
  @Min(10)
  @Max(200)
  walkingRadiusMeters: number;
}
