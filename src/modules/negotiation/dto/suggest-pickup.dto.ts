import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

/**
 * Payload sent when user taps "Send Location" from the in-chat Location Modal.
 */
export class SuggestPickupDto {
  @ApiProperty({ description: 'Friendly name of pickup point', example: 'Corner of 10th & Main' })
  @IsString()
  @IsNotEmpty()
  pickupPointName: string;

  @ApiProperty({ description: 'Latitude', example: 49.2606 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Longitude', example: -123.2460 })
  @IsNumber()
  longitude: number;

  @ApiProperty({ description: 'Proposed pickup time (HH:mm)', example: '08:20' })
  @IsString()
  @IsNotEmpty()
  proposedTime: string;
}
