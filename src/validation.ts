import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export function parse<T>(schema:z.ZodType<T>,value:unknown):T {const r=schema.safeParse(value);if(!r.success)throw new BadRequestException(r.error.flatten());return r.data;}
export const idSchema=z.string().regex(/^[a-f0-9]{24}$/i);
export function objectId(id:string){return parse(idSchema,id);}
export const coordinates=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
export const geo=z.object({type:z.literal('Point'),coordinates}).strict();
export const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const commute=z.object({homeId:idSchema,direction:z.enum(['to-school','home']),dates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).default([]),days:z.array(z.number().int().min(0).max(6)).max(7).default([]),startTime:time,endTime:time}).strict().refine(v=>v.dates.length>0||v.days.length>0,'Choose dates or weekdays').refine(v=>v.endTime>v.startTime,'End time must be after start time').refine(v=>{const min=new Date(Date.now()-864e5).toISOString().slice(0,10);return v.dates.every(d=>d>=min&&!Number.isNaN(Date.parse(d)));},'Dates cannot be in the past');
export const proposalSchema=z.object({pickup:geo,time}).strict();
