import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { useLocation, useNavigate } from 'react-router';
import { Stack, PrimaryButton, IconButton, Form } from '../../lib/denim/lib';
import { GET_KNOWN_CARS } from '../Telemetry/Groups/queries';
import { ADD_CAR, GET_CARS, CarRecord, parseCarIds } from '../Telemetry/carQueries';

// Custom `new` slot — bypasses the generic schema-form Create.tsx, same
// rationale as the show/edit slots: the required UI (friendly name + a
// KnownCar-backed multi-select of raw car_ids) doesn't fit the generic
// single-field-per-schema-entry Form contract.
const CarNew: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [carIds, setCarIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const { data: carsData } = useQuery(GET_CARS, { fetchPolicy: 'cache-and-network' });
  const { data: knownCarsData } = useQuery(GET_KNOWN_CARS, { fetchPolicy: 'cache-and-network' });
  const [addCar] = useMutation(ADD_CAR, { refetchQueries: [{ query: GET_CARS }] });

  const cars: CarRecord[] = (carsData as any)?.getCars ?? [];
  const knownCarIds: string[] = ((knownCarsData as any)?.getKnownCars ?? []).map((c: any) => c.id);
  const claimedIds = new Set(cars.flatMap(parseCarIds));

  const newCarSchema = {
    name: { label: 'Friendly name' },
    carIds: {
      type: 'multi-select' as const,
      label: 'Game car IDs',
      options: knownCarIds.map(id => ({ text: id, value: id, disabled: claimedIds.has(id) })),
    },
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await addCar({ variables: { values: { name: name.trim(), carIds: JSON.stringify(carIds) } } });
      const newId = (result.data as any)?.addCar?.id;
      if (newId) navigate(pathname.replace('new', `${newId}/show`));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: '1.2em 1.5em', maxWidth: 720 }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ marginBottom: '1em' }}>
        <IconButton iconProps={{ iconName: 'Back' }} onClick={() => navigate(pathname.replace('/new', ''))} title="Back" />
        <span style={{ fontSize: '1.2em', fontWeight: 700 }}>New Car</span>
      </Stack>

      <Form
        form={newCarSchema}
        name="newCar"
        initialValues={{ name, carIds }}
        onChange={(_: string, { raw }: any) => {
          setName(raw.name ?? '');
          setCarIds(raw.carIds ?? []);
        }}
      />

      <PrimaryButton disabled={!name.trim() || creating} style={{ marginTop: '1em' }} onClick={handleCreate}>
        {creating ? 'Creating…' : 'Create Car'}
      </PrimaryButton>
    </div>
  );
};

export default CarNew;
