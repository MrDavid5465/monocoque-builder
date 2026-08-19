import gql from 'graphql-tag';

export interface UsbDeviceInfo {
  devid: string;
  vid: string;
  pid: string;
  manufacturer?: string | null;
  product?: string | null;
  serial?: string | null;
}

export const GET_USB_DEVICES = gql`
  query getUsbDevices {
    getUsbDevices {
      devid
      vid
      pid
      manufacturer
      product
      serial
    }
  }
`;
