// The reference material that can be downloaded into the offline library.
//
// Each is one Parquet file on Hugging Face with a column of titles and a
// column of text. To offer another, add it here; nothing else needs to change.

import type { Model } from './models';

export type Source = {
  id: string;
  name: string;
  /** What it holds, in a few words. */
  note: string;
  /** Size of the download. */
  sizeMB: number;
  /** Space the finished index takes on the phone. */
  diskMB: number;
  file: string;
  url: string;
  /** The columns of the file that hold each entry's title and its text. */
  columns: { title: string; text: string };
  /** Words every title begins with, which are left off: a guide is found by "tie a tie", not "how to tie a tie". */
  titlesStartWith?: string;
  /** For a dictionary: only looked in when a question is about one of its entries. */
  entriesOnly?: boolean;
};

const HF = 'https://huggingface.co/datasets';

export const SOURCES: Source[] = [
  {
    id: 'wiki-simple',
    name: 'Wikipedia',
    note: 'Simple English',
    sizeMB: 157,
    diskMB: 500,
    file: 'wikipedia-simple.parquet',
    url: `${HF}/wikimedia/wikipedia/resolve/main/20231101.simple/train-00000-of-00001.parquet`,
    columns: { title: 'title', text: 'text' },
  },
  {
    id: 'wiki-vital',
    name: 'Wikipedia in depth',
    note: '50,000 key articles',
    sizeMB: 674,
    diskMB: 2100,
    file: 'wikipedia-vital.parquet',
    url: `${HF}/AMead10/lvl_5_vital_wikipedia_articles/resolve/main/data/train-00000-of-00001.parquet`,
    columns: { title: 'title', text: 'text' },
  },
  {
    id: 'medicine',
    name: 'Medicine',
    note: '6,800 articles',
    sizeMB: 33,
    diskMB: 100,
    file: 'medicine.parquet',
    url: `${HF}/gamino/wiki_medical_terms/resolve/main/wiki_medical_terms.parquet`,
    columns: { title: 'page_title', text: 'page_text' },
  },
  {
    id: 'dictionary',
    name: 'Dictionary',
    note: '112,000 definitions',
    sizeMB: 9,
    diskMB: 30,
    file: 'dictionary.parquet',
    url: `${HF}/npvinHnivqn/EnglishDictionary/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet`,
    columns: { title: 'word', text: 'definition' },
    entriesOnly: true,
  },
  {
    id: 'howto',
    name: 'How-to guides',
    note: '180,000 guides',
    sizeMB: 287,
    diskMB: 900,
    file: 'howto.parquet',
    url: `${HF}/Lajvi/wikihowAll/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet`,
    columns: { title: 'title', text: 'text' },
    titlesStartWith: 'How to ',
  },
];

/** A source's download, in the shape the download code works with. */
export const sourceDownload = (source: Source): Model => ({
  id: `library-${source.id}`,
  name: source.name,
  note: source.note,
  sizeMB: source.sizeMB,
  file: source.file,
  url: source.url,
  group: 'custom',
});

export const sourceForDownload = (downloadId: string) => SOURCES.find((s) => `library-${s.id}` === downloadId);
