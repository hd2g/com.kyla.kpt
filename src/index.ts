function assert<A = never>(
  value: A,
  message?: string | Error
): asserts value is Exclude<A, null | undefined> {
  if (!value) {
    const err = message instanceof Error
      ? message
      : typeof message === 'string'
      ? new Error(message)
      : new Error('assertion failed')

    throw err
  }
}

const ENV: Record<string, string | undefined> =
  PropertiesService.getScriptProperties().getProperties()

const {
  SCRAPBOX_SID,
  SCRAPBOX_BASE_URL,
  SCRAPBOX_PROJECT_NAME,
  GDRIVE_ROOT_FOLDER_ID,
} = ENV

assert(SCRAPBOX_SID, 'SCRAPBOX_SID is empty')
assert(SCRAPBOX_BASE_URL, 'SCRAPBOX_BASE_URL is empty')
assert(SCRAPBOX_PROJECT_NAME, 'SCRAPBOX_PROJECT_NAME is empty')
assert(GDRIVE_ROOT_FOLDER_ID, 'GDRIVE_ROOT_FOLDER_ID is empty')

/**
 * Utils
 */
const joinPath = (lhs: string, rhs: string): string => {
  const SEPARATOR = '/'

  switch ((lhs.endsWith(SEPARATOR) ? 1 : 0) +
          (rhs.startsWith(SEPARATOR) ? 2 : 0)) {
    case 0:
      return lhs + SEPARATOR + rhs
    case 1:
    case 2:
      return lhs + rhs
    case 3:
      return lhs + rhs.substring(1)
    default:
      throw new Error('Unreachable')
  }
}

const joinPaths = (paths: string[]): string => paths.reduce(joinPath)

/**
* KPT Contents in Scrapbox
*/
const kptContentsKinds = [
  'try',
  'problem',
  'keep',
  'other'
] as const satisfies readonly string[]

type KPTContents = Record<(typeof kptContentsKinds)[number], string>

const emptyKPTContents = Object.fromEntries(
  kptContentsKinds.map(kind => [kind, ''])
) as KPTContents

const parseAsKPTContents = (contents: string): KPTContents => {
  const [_title, ...chunks] = contents.split('\n\n')

  return chunks.reduce<KPTContents>((kpt, chunk) => {
    const [kind$, ...contents] = chunk.split('\n')

    const kind = kind$.match(/\[\[(.+)\]\]/)?.[1]?.toLowerCase()

    if (!kind) return kpt
    if (!(kptContentsKinds as readonly string[]).includes(kind)) return kpt

    return { ...kpt, [kind]: contents.join('\n') }
  }, emptyKPTContents)
}

const getKPTContents = async (tod: Date): Promise<KPTContents> => {
  const year = tod.getFullYear()
  const month = tod.getMonth().toString().padStart(2, '0')
  const url = joinPaths([
    SCRAPBOX_BASE_URL,
    'pages',
    SCRAPBOX_PROJECT_NAME,
    `月報_${year}${month}`,
    'text'
  ])

  const sid = SCRAPBOX_SID

  const response = UrlFetchApp.fetch(url, {
    headers: {
      Cookie: `connect.sid=${sid}`,
    },
  })

  if (response.getResponseCode() !== 200) {
    const headers = response.getHeaders()
    const contents = response.getContentText()
    const responseCode = response.getResponseCode()
    const errInfo = { headers, contents, responseCode }

    throw new Error(JSON.stringify(errInfo))
  }

  const kptContents = parseAsKPTContents(response.getContentText())

  return kptContents
}

/**
 * Month Report in Google Spreadsheet
 */
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet
type GFolder = GoogleAppsScript.Drive.Folder
type GFile = GoogleAppsScript.Drive.File

type GIterLike<A = unknown> = {
  next: () => A
  hasNext: () => boolean
}

function* iterify<A = unknown>(
  iter: GIterLike<A>
): Generator<A, void, unknown> {
  while (iter.hasNext()) {
    yield iter.next()
  }
}

const findFolderByPathnames = async (
  pathnames: string[],
  rootFolderId: string
): Promise<GFolder> => {
  const rootFolder = DriveApp.getFolderById(rootFolderId)

  const found = pathnames.reduce<GFolder | undefined>((folder, pathname) => {
    if (!folder) return folder

    const folders = [...iterify(folder.getFolders())]

    const found = folders.find(folder$ => folder$.getName() === pathname)

    return found
  }, rootFolder)

  if (!found) {
    throw new Error(JSON.stringify({
      found: false,
      pathnames,
      rootFolderId,
    }))
  }

  return found
}

const findSpreadsheetByName = async (
  name: string,
  folder: GFolder
): Promise<Spreadsheet> => {
  const file = [...iterify(folder.getFilesByName(name))][0]
  if (!file) {
    throw new Error(JSON.stringify({
      found: false,
      name,
      folder,
    }))
  }

  const fileId = file.getId()

  return SpreadsheetApp.openById(fileId)
}

const getMonthlyReportSpreadsheet = async (
  tod: Date
): Promise<Spreadsheet> => {
  const year = tod.getFullYear().toString()
  const month = tod.getMonth().toString().padStart(2, '0')

  const pathnames = ['月次資料', year, month]
  const monthlyReportName = `月報_${year}${month}`

  const spreadsheet = await findFolderByPathnames(
    pathnames,
    GDRIVE_ROOT_FOLDER_ID
  ).then(folder => findSpreadsheetByName(monthlyReportName, folder))

  return spreadsheet
}

type UpdateMonthlyReportResult = {
  succeed: boolean
  kpt: KPTContents
  spreadsheet: {
    id: string
    name: string
    url: string
  }
}

const overwriteKPTContents = async (
  kptContents: KPTContents,
  monthlyReportSheet: Spreadsheet
): Promise<UpdateMonthlyReportResult> => {
  monthlyReportSheet.getRange('B8').setValue(kptContents.keep)
  monthlyReportSheet.getRange('B12').setValue(kptContents.problem)
  monthlyReportSheet.getRange('B16').setValue(kptContents.try)
  monthlyReportSheet.getRange('B20').setValue(kptContents.other)

  return {
    succeed: true,
    kpt: kptContents,
    spreadsheet: {
      id: monthlyReportSheet.getId(),
      name: monthlyReportSheet.getName(),
      url: monthlyReportSheet.getUrl(),
    },
  }
}

/**
 * Entry point
 */
async function main() {
  const today = new Date()

  const [
    kptContents,
    monthlyReportSheet,
  ] = await Promise.all([
    getKPTContents(today),
    getMonthlyReportSpreadsheet(today)
  ])

  const updatedResult = await overwriteKPTContents(
    kptContents,
    monthlyReportSheet
  )

  console.log(updatedResult)
}

