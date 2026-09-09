import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Length } from 'class-validator';

export class SubmitBoardingPinDto {
  @ApiProperty({ description: 'Passenger user ID being boarded' })
  @IsString()
  @IsNotEmpty()
  riderId: string;

  @ApiProperty({ description: '4-digit Boarding Safety PIN', example: '4819' })
  @IsString()
  @Length(4, 4)
  pin: string;

  @ApiProperty({ description: 'Single GPS latitude read at moment of boarding', example: 49.2606 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Single GPS longitude read at moment of boarding', example: -123.2460 })
  @IsNumber()
  longitude: number;
}
