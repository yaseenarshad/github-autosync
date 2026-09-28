import { Icon } from './Icon'

export function FirstRun({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div>
        <div className="art">
          <Icon name="logo-octopus" />
        </div>
        <h1>Keep your folders in sync — automatically</h1>
        <p>
          Pick a git folder once. AutoSync commits, pulls, and pushes it on its own, on every computer, and only bothers you when something
          needs you.
        </p>
        <button className="btn blue big" onClick={onAdd}>
          <Icon name="plus" />
          Add your first folder
        </button>
        <div className="steps">
          <span>
            <Icon name="folder" />
            Add a folder
          </span>
          <span>
            <Icon name="sync" />
            It syncs itself
          </span>
          <span>
            <Icon name="alert" />
            You hear only about problems
          </span>
        </div>
      </div>
    </div>
  )
}
