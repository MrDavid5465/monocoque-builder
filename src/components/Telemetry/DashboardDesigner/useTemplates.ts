import { useCallback } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { ComponentNode } from '../../../types/dashboard';
import { detectTemplateType, TemplateGaugeType, deepCopyNode, collectFileRefs } from './components/utils';
import { GET_TEMPLATES, ADD_TEMPLATE, UPDATE_TEMPLATE, REMOVE_TEMPLATE, UPLOAD_TEMPLATE_THUMBNAIL } from './queries';

export interface DashTemplate {
  id: string;
  name: string;
  gaugeType: TemplateGaugeType;
  component: ComponentNode;
  thumbnail?: string | null;
  sprites?: string | null;
}

// Bundled into a saved template's `sprites` field so it renders correctly when
// applied to a dashboard that doesn't already have these files of its own.
export interface TemplateSprite {
  filename: string;
  data: string;
}

function parseTemplate(raw: any): DashTemplate | null {
  try {
    return {
      id:        raw.id,
      name:      raw.name,
      gaugeType: raw.gaugeType as TemplateGaugeType,
      component: JSON.parse(raw.component) as ComponentNode,
      thumbnail: raw.thumbnail ?? null,
      sprites:   raw.sprites ?? null,
    };
  } catch {
    return null;
  }
}

async function urlToDataUrl(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function useTemplates() {
  const { data, loading, refetch } = useQuery(GET_TEMPLATES, { fetchPolicy: 'cache-and-network' });
  const [addTemplateMutation]      = useMutation(ADD_TEMPLATE,    { refetchQueries: [{ query: GET_TEMPLATES }] });
  const [updateTemplateMutation]   = useMutation(UPDATE_TEMPLATE, { refetchQueries: [{ query: GET_TEMPLATES }] });
  const [removeTemplateMutation]   = useMutation(REMOVE_TEMPLATE, { refetchQueries: [{ query: GET_TEMPLATES }] });
  const [uploadThumbnailMutation]  = useMutation(UPLOAD_TEMPLATE_THUMBNAIL, { refetchQueries: [{ query: GET_TEMPLATES }] });

  const templates: DashTemplate[] = (
    (data as any)?.getDashTemplates ?? []
  ).map(parseTemplate).filter(Boolean) as DashTemplate[];

  const createTemplate = useCallback(async (values: { name: string; gaugeType: string; component: string }): Promise<string> => {
    const result = await addTemplateMutation({ variables: { values } });
    return (result.data as any)?.addDashTemplate?.id ?? '';
  }, [addTemplateMutation]);

  const updateTemplate = useCallback(async (id: string, values: { name: string; gaugeType: string; component: string }) => {
    await updateTemplateMutation({ variables: { id, update: values } });
  }, [updateTemplateMutation]);

  const saveTemplate = useCallback(async (
    node: ComponentNode,
    sourceSprites: { file: string; thumbnail: string }[] = [],
  ): Promise<string> => {
    const gaugeType = detectTemplateType(node);
    const spriteMap = new Map(sourceSprites.map(s => [s.file, s.thumbnail]));
    const bundled: TemplateSprite[] = [];
    for (const filename of collectFileRefs(node)) {
      const thumbnail = spriteMap.get(filename);
      if (!thumbnail) continue;
      const data = await urlToDataUrl(thumbnail);
      if (data) bundled.push({ filename, data });
    }
    const result = await addTemplateMutation({
      variables: {
        values: {
          name:      node.name || 'Unnamed template',
          gaugeType,
          component: JSON.stringify(node),
          sprites:   bundled.length ? JSON.stringify(bundled) : undefined,
        },
      },
    });
    return (result.data as any)?.addDashTemplate?.id ?? '';
  }, [addTemplateMutation]);

  const removeTemplate = useCallback(async (id: string) => {
    await removeTemplateMutation({ variables: { id } });
  }, [removeTemplateMutation]);

  const uploadThumbnail = useCallback(async (id: string, data: string) => {
    await uploadThumbnailMutation({ variables: { id, data } });
  }, [uploadThumbnailMutation]);

  const instantiateTemplate = useCallback((tmpl: DashTemplate): ComponentNode => {
    return deepCopyNode(tmpl.component);
  }, []);

  return { templates, loading, saveTemplate, createTemplate, updateTemplate, removeTemplate, uploadThumbnail, instantiateTemplate, refetchTemplates: refetch };
}
