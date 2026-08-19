import gql from 'graphql-tag';

export interface SerialDeviceInfo {
  devpath: string;
  label: string;
}

export const GET_SERIAL_DEVICES = gql`
  query getSerialDevices {
    getSerialDevices {
      devpath
      label
    }
  }
`;
