package dreamweavev1

import (
	"context"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	"github.com/dream-weave/dream-weave/apps/server/internal/projects"
)

type projectTransport struct {
	v1.UnimplementedProjectServiceServer
	projects *projects.Service
}

func (t *projectTransport) CreateProject(ctx context.Context, request *v1.CreateProjectRequest) (*v1.Project, error) {
	project, err := t.projects.Create(ctx, request.GetTitle(), request.GetSummary())
	if err != nil {
		return nil, err
	}
	return projectToProto(project), nil
}

func (t *projectTransport) GetProject(ctx context.Context, request *v1.GetProjectRequest) (*v1.Project, error) {
	project, err := t.projects.Get(ctx, request.GetProjectId())
	if err != nil {
		return nil, err
	}
	return projectToProto(project), nil
}

func (t *projectTransport) UpsertProjectMember(ctx context.Context, request *v1.UpsertProjectMemberRequest) (*v1.ProjectMember, error) {
	if err := t.projects.UpsertMember(ctx, request.GetProjectId(), request.GetUserId(), request.GetRole()); err != nil {
		return nil, err
	}
	return &v1.ProjectMember{ProjectId: request.GetProjectId(), UserId: request.GetUserId(), Role: request.GetRole()}, nil
}

func projectToProto(project projects.Project) *v1.Project {
	return &v1.Project{Id: project.ID, Title: project.Title, Summary: project.Summary, Status: project.Status, Role: project.Role}
}
