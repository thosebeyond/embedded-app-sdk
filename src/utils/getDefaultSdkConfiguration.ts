import {SdkConfiguration} from '../interface';

export default function getDefaultSdkConfiguration(): SdkConfiguration {
  return {
    disableConsoleLogOverride: false,
    disableAutoHandshake: false,
    debugHandshake: false,
  };
}
