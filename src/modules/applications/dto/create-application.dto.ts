import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CommuteDirection, ScheduleType } from '../schemas/rider-application.schema';

export class CreateApplicationDto {
  @ApiProperty({ description: 'ID of the saved home/dorm to use for this application' })
  @IsString()
  @IsNotEmpty()
  homeId: string;

  @ApiProperty({
    enum: CommuteDirection,
    description: 'Direction of travel: HOME_TO_SCHOOL (morning) or SCHOOL_TO_HOME (afternoon)',
    example: CommuteDirection.HOME_TO_SCHOOL,
  })
  @IsEnum(CommuteDirection)
  direction: CommuteDirection;

  @ApiProperty({
    enum: ScheduleType,
    description: 'Schedule type: ONE_TIME date or RECURRING weekly days',
    example: ScheduleType.ONE_TIME,
  })
  @IsEnum(ScheduleType)
  scheduleType: ScheduleType;

  @ApiProperty({ description: 'Target date (YYYY-MM-DD) for ONE_TIME commutes', required: false })
  @IsOptional()
  @IsString()
  targetDate?: string;

  @ApiProperty({
    description: 'Array of weekdays for RECURRING commutes (e.g. MONDAY, WEDNESDAY)',
    required: false,
    type: [String],
  })
  @IsOptional()
  recurringDays?: string[];

  @ApiProperty({ description: 'Desired arrival or departure time (HH:mm)', example: '08:30' })
  @IsString()
  @IsNotEmpty()
  targetTime: string;

  @ApiProperty({ description: 'Additional notes or requirements', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
