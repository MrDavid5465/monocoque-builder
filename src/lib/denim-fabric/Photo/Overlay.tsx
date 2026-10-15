import React from 'react';
import { IconButton } from './icons';

interface Props {
  methods: { edit: () => void; download: () => void; remove: () => void };
}

const Overlay: React.FC<Props> = ({ methods }) => {
  return (
    <div>
      <IconButton icon="crop" onClick={methods.edit} />
      <IconButton icon="download" onClick={methods.download} />
      <IconButton icon="trash" onClick={methods.remove} />
    </div>
  );
};
export default Overlay;
