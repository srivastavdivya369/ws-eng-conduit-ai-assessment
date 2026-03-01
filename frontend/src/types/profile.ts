import { Decoder, string, nullable, boolean, object, hardcoded, either, number } from 'decoders';
import { PublicUser } from './user';

export interface Profile extends PublicUser {
  id: number; // may be -1 when coming from /profiles/:username
  following: boolean;
}

export const profileDecoder: Decoder<Profile> = object({
  id: either(number, hardcoded(-1)),
  username: string,
  bio: nullable(string),
  image: nullable(string),
  following: either(boolean, hardcoded(false)),
});
